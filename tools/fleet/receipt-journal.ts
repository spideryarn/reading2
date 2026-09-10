/**
 * Durable evidence for actions accepted by the fleet dashboard.
 *
 * The journal records evidence, not optimism: submitting every tmux key is the
 * strongest transport claim available here, and an ambiguous attempt is never
 * retried automatically. Message text lives only in short-lived material
 * files, never in this JSONL history.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

import { writeAll, type JsonlRepair } from "../overseer/jsonl.js";
import { stillOurs } from "../overseer/lock.js";
import type { SpokenAction } from "./actions.js";
import {
  openJournalFile,
  type JournalFile,
  type SharedJournalLock,
} from "./journal-file.js";
import type { SendAttempt } from "./send-coordinator.js";
import type { PlanStepStatus, ReceiptSummary, Speaker } from "./wire.js";

export const RECEIPTS_FILE = "receipts.jsonl";
export const UNREADABLE_RECEIPTS_FILE = "receipts.unreadable.jsonl";
export const MATERIAL_DIR = "material";
export const MAX_WHAT_CHARS = 200;
export const MAX_WHY_CHARS = 500;
/** A plan step's gate verdict, bounded. Never message text: step index, status and this. */
export const MAX_VERDICT_CHARS = 200;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const REQUEST_ID_SKEW_MS = 60 * 60 * 1_000;
export const KEYED_RECEIPT_CAP = 5_000;
export const UNKEYED_TERMINAL_CAP = 5_000;
export const NON_TERMINAL_CAP = 1_000;
export const MIN_COMPACT_BYTES = 1024 * 1024;

/* A forgotten key was accepted no later than one hour after it was minted and
   is retained for seven days after acceptance. Therefore an unknown key old
   enough to have been forgotten is at least 7 days - 1 hour old, far outside
   this ±1 hour admission window, and is refused rather than replayed as new. */

export type ReceiptActor = {
  kind: "client-claimed" | "unattributed-http" | "system";
  id: string | null;
};
/**
 * What was accepted, when it is about one session.
 *
 * - `queued-*`: queued work, delivered later by the drain; the only restorable ops.
 * - `steer-*`: direct keystrokes from `routes-steer.ts` — typed at once, never queued, never restored.
 * - `enacted-session`: `remove-worktree` or `kill-session` run from one session's row (Stage 3).
 * - `broadcast-recipient`: a direct send to one recipient of a broadcast — a child of a `broadcast`.
 */
export type SessionReceiptOp =
  | "queued-message"
  | "queued-action"
  | "steer-message"
  | "steer-answer"
  | "enacted-session"
  | "broadcast-recipient";
/**
 * What was accepted, when it is about the whole box (Stage 3). **Its target is null**:
 * a box kill names no session, and a broadcast's sessions are its children.
 *
 * - `enacted-box`: a box-wide kill on `/api/actions/box`.
 * - `broadcast`: the parent of one broadcast request (free text or ease-off). It carries the
 *   request id; each recipient's receipt names it in `parentReceiptId`.
 */
export type BoxReceiptOp = "enacted-box" | "broadcast";
export type ReceiptOp = SessionReceiptOp | BoxReceiptOp;
export type ReceiptOrigin = "enqueue" | "broadcast" | "direct-steer" | "enacted";
export type ReceiptTarget = {
  sessionId: string;
  paneId: string | null;
  claudeSessionId: string | null;
  tmuxGeneration: number | null;
};
export type ReceiptQueue = { itemId: string; enqueuedAt: number };

/**
 * The op and its target together, so a box-scoped receipt cannot carry a session
 * and a session-scoped one cannot lack one. **Never a sentinel session id.** The
 * parser enforces the same pairing on every line it reads.
 */
export type ReceiptScope = { op: SessionReceiptOp; target: ReceiptTarget } | { op: BoxReceiptOp; target: null };

type RecordBase<K extends string> = { schema: 1; kind: K; at: number };
type AcceptedFields = {
  receiptId: string;
  requestId: string | null;
  fingerprint: string | null;
  origin: ReceiptOrigin;
  actor: ReceiptActor;
  speaker: Speaker | null;
  what: string;
  serverInstanceId: string;
  queue: ReceiptQueue | null;
  /**
   * The broadcast this receipt is one recipient of, or null. Set on every child
   * of a broadcast — a direct `broadcast-recipient` and a queued item alike —
   * and only on those. A line written before Stage 3 has no such field and is
   * read as null.
   */
  parentReceiptId: string | null;
};
export type AcceptedReceiptRecord = RecordBase<"accepted"> & AcceptedFields & ReceiptScope;
export type AttemptedReceiptRecord = RecordBase<"attempted"> & { receiptId: string };
/**
 * One step of an enacted plan finished, and what its gate said (Stage 3).
 *
 * `step` is the zero-based index `runPlan` uses (`PlanRun.stoppedAt`). Legal only
 * for an enacted op, after `attempted` and before the outcome, once per index,
 * in order. It is evidence ON the receipt and never its `last`: the receipt stays
 * `attempted` until an outcome lands, so recovery reads a crash mid-plan exactly
 * as it reads any other interrupted attempt — and the progress records say how
 * far it is known to have got. **Never a word of message text**: an index, a
 * status and a bounded verdict.
 */
export type ProgressReceiptRecord = RecordBase<"progress"> & {
  receiptId: string;
  step: number;
  status: PlanStepStatus;
  verdict: string;
};
export type ReturnedReceiptRecord = RecordBase<"returned"> & { receiptId: string; code: string };

export type KeysSubmittedOutcome = {
  state: "keys-submitted";
  reason: "transport-ok";
  code: string | null;
  why: string;
};
export type NotSentOutcome = {
  state: "not-sent";
  reason:
    | "transport-refused-unsent"
    | "session-held"
    | "undeliverable"
    | "lost-at-restart"
    | "tmux-generation-changed"
    | "tmux-generation-unproven"
    /**
     * A durably accepted direct send whose `attempted` could not be written.
     * `attempted` is fail-closed for such a receipt, so nothing was typed.
     */
    | "attempt-not-recorded"
    /**
     * Recovery found a direct send (`queue: null`) at `accepted`, on disk,
     * with no `attempted`. Because `attempted` is fail-closed for a durable
     * receipt, that is proof it was never attempted. Never restored: a direct
     * send is not queued work.
     */
    | "interrupted-before-attempt"
    /**
     * A broadcast's fan-out passed its deadline before this recipient. It was
     * accepted as a child so the broadcast accounts for it, and never attempted.
     */
    | "not-reached"
    /**
     * An enacted plan or broadcast accepted at its one-way door, then refused by
     * a check that can only run after it — the box unreadable, nothing left to
     * kill, a stored preview that no longer parses. Nothing was attempted; `code`
     * names the refusal.
     */
    | "refused-before-attempt";
  code: string | null;
  why: string;
};
export type UnknownOutcome = {
  state: "outcome-unknown";
  reason:
    | "partial"
    | "unknown"
    | "none-contradicted"
    | "threw"
    | "interrupted"
    | "lease-abandoned"
    | "recovery-blocked";
  code: string | null;
  why: string;
};
/**
 * Stage 3. `plan-passed`: an enacted plan passed every gate. `fan-out-finished`:
 * a broadcast's fan-out came to an end with every recipient it began accounted
 * for by its own child receipt — which says nothing about what those children
 * say; the parent's `why` counts them.
 */
export type CompletedOutcome = {
  state: "completed";
  reason: "plan-passed" | "fan-out-finished";
  code: string | null;
  why: string;
};
/** Stage 3. An enacted plan stopped because a gate refused at step k; `code` is `step-<k>`, zero-based. */
export type PlanStoppedOutcome = {
  state: "plan-stopped";
  reason: "gate-refused";
  code: string | null;
  why: string;
};
export type ReceiptOutcome = KeysSubmittedOutcome | NotSentOutcome | UnknownOutcome | CompletedOutcome | PlanStoppedOutcome;
export type OutcomeReceiptRecord = RecordBase<"outcome"> & { receiptId: string } & ReceiptOutcome;
/**
 * **A PERSON'S STATEMENT BESIDE AN UNKNOWN, NEVER A NEW OUTCOME.**
 *
 * - `lease-abandoned`: the abandon route cleared a leased queued item (Stage 1).
 * - `operator-confirmed` / `abandoned-unknown`: somebody looked at an enacted
 *   plan whose outcome is unknown and said so (Stage 4, `POST
 *   /api/actions/receipts/reconcile`). Legal only on `enacted-session` and
 *   `enacted-box`. Neither changes the receipt's state: an unknown stays
 *   unknown, and this record says who looked and when.
 */
export type ReconcileDisposition = "lease-abandoned" | "operator-confirmed" | "abandoned-unknown";
/** The two a person may record against an enacted plan. */
export type OperatorDisposition = Exclude<ReconcileDisposition, "lease-abandoned">;
export const OPERATOR_DISPOSITIONS: readonly OperatorDisposition[] = ["operator-confirmed", "abandoned-unknown"];
export type ReconciledReceiptRecord = RecordBase<"reconciled"> & {
  receiptId: string;
  disposition: ReconcileDisposition;
  actor: ReceiptActor;
};
export type WithdrawnReceiptRecord = RecordBase<"withdrawn"> & {
  receiptIds: string[];
  reason: "cancelled" | "cleared";
  actor: ReceiptActor;
};
export type GenerationReceiptRecord = RecordBase<"generation"> & { pid: number };
export type ReceiptRecord =
  | AcceptedReceiptRecord
  | AttemptedReceiptRecord
  | ReturnedReceiptRecord
  | OutcomeReceiptRecord
  | ReconciledReceiptRecord
  | WithdrawnReceiptRecord
  | GenerationReceiptRecord
  | ProgressReceiptRecord;

export type ReceiptMaterial =
  | { kind: "message"; text: string; speaker: Speaker }
  | { kind: "action"; action: SpokenAction; speaker: Speaker };

export type AcceptReceiptInput = Omit<AcceptedFields, "receiptId" | "serverInstanceId" | "parentReceiptId"> &
  ReceiptScope & {
    /** Null, the default, unless this is one recipient of a broadcast. */
    parentReceiptId?: string | null | undefined;
    /** Preferred production path: the store pins this before writing accepted. */
    material?: ReceiptMaterial | undefined;
  };

export type ReceiptState = {
  receiptId: string;
  accepted: AcceptedReceiptRecord;
  /** Never a `progress` record: see `ProgressReceiptRecord`. */
  last:
    | Exclude<ReceiptRecord, AcceptedReceiptRecord | GenerationReceiptRecord | ProgressReceiptRecord>
    | AcceptedReceiptRecord;
  records: ReceiptRecord[];
  materialDeletionPending: boolean;
};

export type RestorableItem = {
  receiptId: string;
  op: ReceiptOp;
  origin: ReceiptOrigin;
  actor: ReceiptActor;
  speaker: Speaker | null;
  target: ReceiptTarget;
  what: string;
  queue: ReceiptQueue;
  material: ReceiptMaterial;
  tmuxGeneration: number | null;
};

export type RecoveryConclusion = { receiptId: string; state: ReceiptOutcome["state"]; reason: ReceiptOutcome["reason"] };
export type RecoverySummary = {
  blocked: boolean;
  reason: string | null;
  generationUnproven: boolean;
  interrupted: string[];
  /** Direct sends found at `accepted` with no `attempted`: proven never typed. */
  interruptedBeforeAttempt: string[];
  lostAtRestart: string[];
  recoveryBlocked: string[];
  orphanEvidence: string[];
  wouldConclude: RecoveryConclusion[];
};

export type ReceiptJournalStatus = {
  dir: string;
  file: string | null;
  lockedOutBy: string | null;
  failure: string | null;
  unreadableLines: number;
  repaired: JsonlRepair;
  compactions: number;
  illegalTransitions: number;
  materialDeletionPending: string[];
  keyedReceipts: number;
  nonTerminalReceipts: number;
  neverOpened: boolean;
};

export type ReceiptJournal = {
  accept(input: AcceptReceiptInput): { ok: true; receiptId: string; durable: boolean } | { ok: false; why: string };
  /** Test/recovery seam. Production callers should pass material to accept. */
  putMaterial(receiptId: string, payload: ReceiptMaterial): boolean;
  attempted(receiptId: string): { landed: boolean };
  /**
   * One finished step of an enacted plan. **Fail-open**: a lost line only makes
   * a crash report fewer completed steps, which is the conservative direction.
   */
  progress(receiptId: string, step: number, status: PlanStepStatus, verdict: string): boolean;
  returned(receiptId: string, code: string): boolean;
  outcome(receiptId: string, arm: ReceiptOutcome): boolean;
  withdrawn(receiptIds: string[], reason: "cancelled" | "cleared", actor: ReceiptActor): boolean;
  /**
   * One statement beside an `outcome-unknown` receipt. The journal refuses a
   * second one (the first becomes the receipt's `last`, so it is no longer an
   * unknown outcome awaiting a statement) and an operator disposition on
   * anything but an enacted plan.
   */
  reconcile(receiptId: string, disposition: ReconcileDisposition, actor: ReceiptActor): boolean;
  noteGeneration(pid: number): void;
  lastGeneration(): number | null;
  get(receiptId: string): ReceiptState | null;
  byRequestId(requestId: string): ReceiptState | null;
  /** Every receipt whose `parentReceiptId` names this one, in acceptance order. */
  childrenOf(parentReceiptId: string): ReceiptState[];
  recent(limit: number): ReceiptState[];
  forSession(sessionId: string): ReceiptState[];
  nonTerminal(): ReceiptState[];
  restorable(): RestorableItem[];
  unknownKeystrokeReceipts(): ReceiptState[];
  durable(): boolean;
  acceptedDurably(receiptId: string): boolean;
  /** Every record in this receipt's current in-memory fold exists on disk. */
  evidenceDurable?(receiptId: string): boolean;
  reservedQueueItemIds(): string[];
  compact(): boolean;
  recovery(): RecoverySummary;
  status(): ReceiptJournalStatus;
  close(): void;
};

export type OpenReceiptJournalOptions = {
  lock: SharedJournalLock;
  now: () => number;
  serverInstanceId: string;
  writeLine?: ((fd: number, line: string) => void) | undefined;
  onTrouble?: ((why: string) => void) | undefined;
  /** Test-only small caps exercise admission without writing thousands of lines. */
  keyedReceiptCap?: number | undefined;
  nonTerminalCap?: number | undefined;
  deleteMaterial?: ((path: string) => void) | undefined;
  unkeyedTerminalCap?: number | undefined;
};

export type OpenedReceiptJournal = { kind: "open"; journal: ReceiptJournal } | { kind: "refused"; why: string };

const SPEAKERS: readonly Speaker[] = ["greg", "overseer", "dashboard"];
const SESSION_OPS: readonly SessionReceiptOp[] = [
  "queued-message", "queued-action", "steer-message", "steer-answer", "enacted-session", "broadcast-recipient",
];
const BOX_OPS: readonly BoxReceiptOp[] = ["enacted-box", "broadcast"];
const OPS: readonly ReceiptOp[] = [...SESSION_OPS, ...BOX_OPS];
const ORIGINS: readonly ReceiptOrigin[] = ["enqueue", "broadcast", "direct-steer", "enacted"];
const ACTOR_KINDS: readonly ReceiptActor["kind"][] = ["client-claimed", "unattributed-http", "system"];
const NOT_SENT_REASONS: readonly NotSentOutcome["reason"][] = [
  "transport-refused-unsent", "session-held", "undeliverable", "lost-at-restart",
  "tmux-generation-changed", "tmux-generation-unproven", "attempt-not-recorded", "interrupted-before-attempt",
  "not-reached", "refused-before-attempt",
];
const UNKNOWN_REASONS: readonly UnknownOutcome["reason"][] = [
  "partial", "unknown", "none-contradicted", "threw", "interrupted", "lease-abandoned", "recovery-blocked",
];
const RECONCILE_DISPOSITIONS: readonly ReconcileDisposition[] = ["lease-abandoned", ...OPERATOR_DISPOSITIONS];
const STEP_STATUSES: readonly PlanStepStatus[] = ["passed", "failed", "failed-ignored"];
const ACTION_KINDS = new Set(["accepted", "attempted", "returned", "outcome", "reconciled", "withdrawn", "progress"]);
const ACCEPTED_KEYS = [
  "schema", "kind", "at", "receiptId", "requestId", "fingerprint", "op", "origin", "actor", "speaker", "target", "what",
  "serverInstanceId", "queue",
] as const;

/** A box-scoped op: its receipt's target is null. */
export function isBoxOp(op: ReceiptOp): op is BoxReceiptOp {
  return (BOX_OPS as readonly ReceiptOp[]).includes(op);
}
/** An op whose effect is a plan of steps, and so the only kind of receipt with `progress`. */
export function isEnactedOp(op: ReceiptOp): op is "enacted-session" | "enacted-box" {
  return op === "enacted-session" || op === "enacted-box";
}
function progressCount(state: ReceiptState): number {
  return state.records.filter((record) => record.kind === "progress").length;
}
/** `completed` and `plan-stopped` belong to the ops that can produce them, and to no other. */
function outcomeFitsOp(op: ReceiptOp, arm: ReceiptOutcome): boolean {
  switch (arm.state) {
    case "completed":
      return arm.reason === "plan-passed" ? isEnactedOp(op) : op === "broadcast";
    case "plan-stopped":
      return isEnactedOp(op);
    case "keys-submitted":
    case "not-sent":
    case "outcome-unknown":
      return true;
    default: {
      const never: never = arm;
      return never;
    }
  }
}

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function string(v: unknown): v is string { return typeof v === "string" && v !== ""; }
function nullableString(v: unknown): v is string | null { return v === null || typeof v === "string"; }
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(v).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function actor(v: unknown): v is ReceiptActor {
  return object(v) && exact(v, ["kind", "id"]) && ACTOR_KINDS.includes(v["kind"] as ReceiptActor["kind"])
    && nullableString(v["id"])
    && (v["kind"] === "client-claimed" ? string(v["id"]) : v["id"] === null);
}
function target(v: unknown): v is ReceiptTarget {
  return object(v) && exact(v, ["sessionId", "paneId", "claudeSessionId", "tmuxGeneration"])
    && string(v["sessionId"]) && nullableString(v["paneId"]) && nullableString(v["claudeSessionId"])
    && (v["tmuxGeneration"] === null || finite(v["tmuxGeneration"]));
}
function queue(v: unknown): v is ReceiptQueue | null {
  return v === null || (object(v) && exact(v, ["itemId", "enqueuedAt"]) && string(v["itemId"]) && finite(v["enqueuedAt"]));
}

/** Strict parse: unknown schema, missing/extra fields, or bad union pairing are unreadable evidence. */
export function parseReceiptLine(line: string): ReceiptRecord | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!object(value) || value["schema"] !== 1 || !finite(value["at"]) || typeof value["kind"] !== "string") return null;
  const base = { schema: 1 as const, at: value["at"] };
  if (value["kind"] === "generation") {
    if (!exact(value, ["schema", "kind", "at", "pid"]) || !Number.isInteger(value["pid"]) || (value["pid"] as number) <= 0) return null;
    return { ...base, kind: "generation", pid: value["pid"] as number };
  }
  if (value["kind"] === "withdrawn") {
    if (!exact(value, ["schema", "kind", "at", "receiptIds", "reason", "actor"]) || !Array.isArray(value["receiptIds"])
      || value["receiptIds"].length === 0 || !value["receiptIds"].every(string)
      || new Set(value["receiptIds"]).size !== value["receiptIds"].length
      || !["cancelled", "cleared"].includes(value["reason"] as string) || !actor(value["actor"])) return null;
    return { ...base, kind: "withdrawn", receiptIds: value["receiptIds"] as string[], reason: value["reason"] as "cancelled" | "cleared", actor: value["actor"] };
  }
  if (!string(value["receiptId"])) return null;
  const receiptId = value["receiptId"];
  if (value["kind"] === "accepted") {
    /* A Stage 1/2 line has no `parentReceiptId`, and reads as having no parent:
       the receipts file already on the box stays readable across this deploy. */
    const legacy = !Object.hasOwn(value, "parentReceiptId");
    const parent = legacy ? null : value["parentReceiptId"];
    const op = value["op"] as ReceiptOp;
    const parentValid = legacy
      ? op !== "broadcast-recipient"
      : parent === null
        ? op !== "broadcast-recipient"
        : string(parent) && value["origin"] === "broadcast"
          && (op === "broadcast-recipient"
            ? value["queue"] === null
            : (op === "queued-message" || op === "queued-action") && value["queue"] !== null);
    if (!exact(value, legacy ? ACCEPTED_KEYS : [...ACCEPTED_KEYS, "parentReceiptId"])
      || !nullableString(value["requestId"]) || !nullableString(value["fingerprint"])
      || ((value["requestId"] === null) !== (value["fingerprint"] === null))
      || !OPS.includes(op) || !ORIGINS.includes(value["origin"] as ReceiptOrigin)
      || !actor(value["actor"]) || !(value["speaker"] === null || SPEAKERS.includes(value["speaker"] as Speaker))
      // Null exactly for a box-scoped op — never a sentinel session.
      || !(isBoxOp(op) ? value["target"] === null : target(value["target"]))
      || typeof value["what"] !== "string" || value["what"].length > MAX_WHAT_CHARS
      || !string(value["serverInstanceId"]) || !queue(value["queue"])
      // A direct broadcast child always names its parent. A parent link is
      // otherwise legal only on a queued broadcast recipient. Legacy lines
      // predate the field and remain readable above as parentless.
      || !parentValid) return null;
    return { ...base, kind: "accepted", receiptId, requestId: value["requestId"] as string | null,
      fingerprint: value["fingerprint"] as string | null, op, origin: value["origin"] as ReceiptOrigin,
      actor: value["actor"], speaker: value["speaker"] as Speaker | null, target: value["target"],
      what: value["what"].slice(0, MAX_WHAT_CHARS), serverInstanceId: value["serverInstanceId"], queue: value["queue"],
      parentReceiptId: parent as string | null } as AcceptedReceiptRecord;
  }
  if (value["kind"] === "attempted") {
    return exact(value, ["schema", "kind", "at", "receiptId"]) ? { ...base, kind: "attempted", receiptId } : null;
  }
  if (value["kind"] === "progress") {
    const step = value["step"];
    return exact(value, ["schema", "kind", "at", "receiptId", "step", "status", "verdict"])
      && typeof step === "number" && Number.isSafeInteger(step) && step >= 0
      && STEP_STATUSES.includes(value["status"] as PlanStepStatus)
      && typeof value["verdict"] === "string" && value["verdict"].length <= MAX_VERDICT_CHARS
      ? { ...base, kind: "progress", receiptId, step, status: value["status"] as PlanStepStatus, verdict: value["verdict"] }
      : null;
  }
  if (value["kind"] === "returned") {
    return exact(value, ["schema", "kind", "at", "receiptId", "code"]) && string(value["code"])
      ? { ...base, kind: "returned", receiptId, code: value["code"] } : null;
  }
  if (value["kind"] === "reconciled") {
    return exact(value, ["schema", "kind", "at", "receiptId", "disposition", "actor"])
      && RECONCILE_DISPOSITIONS.includes(value["disposition"] as ReconcileDisposition) && actor(value["actor"])
      ? { ...base, kind: "reconciled", receiptId, disposition: value["disposition"] as ReconcileDisposition, actor: value["actor"] } : null;
  }
  if (value["kind"] !== "outcome" || !exact(value, ["schema", "kind", "at", "receiptId", "state", "reason", "code", "why"])
    || !nullableString(value["code"]) || typeof value["why"] !== "string" || value["why"].length > MAX_WHY_CHARS) return null;
  const common = { ...base, kind: "outcome" as const, receiptId, code: value["code"], why: value["why"] };
  if (value["state"] === "keys-submitted" && value["reason"] === "transport-ok") return { ...common, state: "keys-submitted", reason: "transport-ok" };
  if (value["state"] === "not-sent" && NOT_SENT_REASONS.includes(value["reason"] as NotSentOutcome["reason"])) {
    return { ...common, state: "not-sent", reason: value["reason"] as NotSentOutcome["reason"] };
  }
  if (value["state"] === "outcome-unknown" && UNKNOWN_REASONS.includes(value["reason"] as UnknownOutcome["reason"])) {
    return { ...common, state: "outcome-unknown", reason: value["reason"] as UnknownOutcome["reason"] };
  }
  if (value["state"] === "completed" && (value["reason"] === "plan-passed" || value["reason"] === "fan-out-finished")) {
    return { ...common, state: "completed", reason: value["reason"] };
  }
  if (value["state"] === "plan-stopped" && value["reason"] === "gate-refused") {
    return { ...common, state: "plan-stopped", reason: "gate-refused" };
  }
  return null;
}

function receiptLine(record: ReceiptRecord): string { return `${JSON.stringify(record)}\n`; }

export function parseRequestId(v: unknown, _now: number): { ok: true; mintedAt: number } | { ok: false; reason: "bad-format" } {
  if (typeof v !== "string") return { ok: false, reason: "bad-format" };
  const match = /^rq-([a-z0-9]+)-([a-z0-9]{16,40})$/.exec(v);
  if (match === null || match[1] === undefined) return { ok: false, reason: "bad-format" };
  const mintedAt = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(mintedAt) || mintedAt < 0 || mintedAt.toString(36) !== match[1]) return { ok: false, reason: "bad-format" };
  return { ok: true, mintedAt };
}
export function admitUnknownRequestId(mintedAt: number, now: number): boolean {
  return Number.isSafeInteger(mintedAt) && Math.abs(mintedAt - now) <= REQUEST_ID_SKEW_MS;
}

export function openReceiptJournal(dir: string, options: OpenReceiptJournalOptions): OpenedReceiptJournal {
  const opened = openJournalFile<ReceiptRecord>(dir, {
    file: RECEIPTS_FILE,
    parse: parseReceiptLine,
    serialise: receiptLine,
    lock: options.lock,
    writeLine: options.writeLine,
    onTrouble: options.onTrouble,
    directoryLabel: "receipt journal directory",
    lockRefusalSuffix: "This dashboard is reading receipts but not adding durable ones.",
    unavailableSuffix: "Actions accepted here will not have durable receipts.",
    closedBy: "this receipt journal has been closed; its writer claim belongs to the action-store composition",
  });
  if (opened.kind === "refused") return opened;
  if (opened.journal.status().lockedOutBy === null) {
    try { mkdirSync(join(dir, MATERIAL_DIR), { recursive: true, mode: 0o700 }); }
    catch (err) { opened.journal.close(); return { kind: "refused", why: `could not create ${join(dir, MATERIAL_DIR)}: ${errorText(err)}` }; }
  }
  const journal = makeReceiptJournal({ core: opened.journal, dir, ...options, memoryOnly: false });
  journal.openRecover();
  return { kind: "open", journal };
}

export function memoryReceiptJournal(options: {
  now: () => number;
  serverInstanceId: string;
  keyedReceiptCap?: number;
  nonTerminalCap?: number;
  unkeyedTerminalCap?: number;
  onTrouble?: (why: string) => void;
}): ReceiptJournal {
  return makeReceiptJournal({ ...options, core: null, dir: "never opened", memoryOnly: true });
}

type InternalJournal = ReceiptJournal & { openRecover(): void };
type MakerOptions = {
  core: JournalFile<ReceiptRecord> | null;
  dir: string;
  now: () => number;
  serverInstanceId: string;
  memoryOnly: boolean;
  lock?: SharedJournalLock | undefined;
  keyedReceiptCap?: number | undefined;
  nonTerminalCap?: number | undefined;
  onTrouble?: ((why: string) => void) | undefined;
  deleteMaterial?: ((path: string) => void) | undefined;
  unkeyedTerminalCap?: number | undefined;
};

function makeReceiptJournal(options: MakerOptions): InternalJournal {
  const core = options.core;
  const states = new Map<string, ReceiptState>();
  const requestIds = new Map<string, string>();
  const reservedReceipts = new Set<string>();
  const reservedQueue = new Set<string>();
  const durableAccepted = new Set<string>();
  /** Durable accepts followed by a fail-open record which has not reached disk. */
  const incompleteDurableEvidence = new Set<string>();
  /** Receipts deliberately kept only for this run after an unkeyed write failure. */
  const volatileReceipts = new Set<string>();
  /** Durable attempts whose fail-open `returned` exists only in this fold. */
  const unlandedReturns = new Set<string>();
  /** Non-terminal evidence which recovery must never offer back to the queue. */
  const recoverySuppressed = new Set<string>();
  const materialMemory = new Map<string, ReceiptMaterial>();
  const pendingDeletion = new Set<string>();
  const records: ReceiptRecord[] = [];
  const deleteFile = options.deleteMaterial ?? unlinkSync;
  const recovery: RecoverySummary = {
    blocked: false, reason: null, generationUnproven: false, interrupted: [], interruptedBeforeAttempt: [],
    lostAtRestart: [], recoveryBlocked: [], orphanEvidence: [], wouldConclude: [],
  };
  let generation: number | null = null;
  let illegalTransitions = 0;
  let domainFailure: string | null = null;
  let receiptSequence = 0;
  let sizeAfterCompaction = 0;
  let recovering = false;
  let unreadableSafeToCompact = (core?.rawUnreadableLines().length ?? 0) === 0;
  let recoveryFailure: string | null = null;

  const physicalWritable = (): boolean => core !== null && core.status().lockedOutBy === null;
  const memoryFallback = (): boolean => options.memoryOnly || (core?.status().lockedOutBy ?? null) !== null;
  const trouble = (why: string): void => {
    if (domainFailure === why) return;
    domainFailure = why;
    options.onTrouble?.(why);
  };
  const view = (state: ReceiptState): ReceiptState => ({
    ...state, records: [...state.records], materialDeletionPending: pendingDeletion.has(state.receiptId),
  });
  const isNonTerminal = (state: ReceiptState): boolean => ["accepted", "attempted", "returned"].includes(state.last.kind);
  const isUnknown = (state: ReceiptState): boolean => state.last.kind === "outcome" && state.last.state === "outcome-unknown";

  const validTransition = (state: ReceiptState | undefined, record: ReceiptRecord): boolean => {
    if (record.kind === "accepted") return state === undefined;
    if (record.kind === "generation") return true;
    if (record.kind === "withdrawn") return record.receiptIds.every((id) => {
      const found = states.get(id);
      return found !== undefined && (found.last.kind === "accepted" || found.last.kind === "returned");
    });
    if (state === undefined) return false;
    if (record.kind === "attempted") return state.last.kind === "accepted" || state.last.kind === "returned";
    if (record.kind === "returned") return state.last.kind === "attempted";
    if (record.kind === "progress") {
      return state.last.kind === "attempted" && isEnactedOp(state.accepted.op) && record.step === progressCount(state);
    }
    if (record.kind === "outcome") {
      if (!outcomeFitsOp(state.accepted.op, record)) return false;
      if (state.last.kind === "attempted") return true;
      if (state.last.kind === "accepted" || state.last.kind === "returned") {
        return record.state === "not-sent" || (record.state === "outcome-unknown" && record.reason === "recovery-blocked");
      }
      return false;
    }
    /* A person's statement about an enacted plan is legal only on one; the
       abandon route's `lease-abandoned` is about a leased queued item. */
    return record.kind === "reconciled" && isUnknown(state)
      && (record.disposition === "lease-abandoned" || isEnactedOp(state.accepted.op));
  };

  const apply = (record: ReceiptRecord, fromDisk = false): boolean => {
    if (record.kind === "generation") { generation = record.pid; records.push(record); return true; }
    if (record.kind === "withdrawn") {
      if (!validTransition(undefined, record)) return false;
      records.push(record);
      for (const id of record.receiptIds) {
        const state = states.get(id)!;
        state.records.push(record);
        state.last = record;
      }
      return true;
    }
    const state = states.get(record.receiptId);
    if (!validTransition(state, record)) return false;
    records.push(record);
    reservedReceipts.add(record.receiptId);
    if (record.kind === "accepted") {
      const next: ReceiptState = { receiptId: record.receiptId, accepted: record, last: record, records: [record], materialDeletionPending: false };
      states.set(record.receiptId, next);
      if (record.requestId !== null) requestIds.set(record.requestId, record.receiptId);
      if (record.queue !== null) reservedQueue.add(record.queue.itemId);
      if (fromDisk) durableAccepted.add(record.receiptId);
      const suffix = currentRunReceiptSuffix(record.receiptId, options.serverInstanceId);
      if (suffix !== null) receiptSequence = Math.max(receiptSequence, suffix);
    } else if (record.kind === "progress") {
      // Evidence on the receipt, never its `last`: see `ProgressReceiptRecord`.
      state!.records.push(record);
    } else {
      state!.records.push(record);
      state!.last = record;
    }
    return true;
  };

  const reserveRecordIds = (record: ReceiptRecord): void => {
    if (record.kind === "generation") return;
    const ids = record.kind === "withdrawn" ? record.receiptIds : [record.receiptId];
    for (const id of ids) {
      reservedReceipts.add(id);
      const suffix = currentRunReceiptSuffix(id, options.serverInstanceId);
      if (suffix !== null) receiptSequence = Math.max(receiptSequence, suffix);
    }
    if (record.kind === "accepted" && record.queue !== null) reservedQueue.add(record.queue.itemId);
  };

  const recordReceiptIds = (record: ReceiptRecord): string[] => {
    if (record.kind === "generation") return [];
    return record.kind === "withdrawn" ? record.receiptIds : [record.receiptId];
  };

  const append = (
    record: ReceiptRecord,
    policy: { failOpen?: boolean; forceMemory?: boolean } = {},
  ): { accepted: boolean; landed: boolean } => {
    if (parseReceiptLine(receiptLine(record)) === null) {
      trouble(`refused invalid ${record.kind} receipt record`);
      return { accepted: false, landed: false };
    }
    const state = record.kind === "withdrawn" || record.kind === "generation" ? undefined : states.get(record.receiptId);
    if (!validTransition(state, record)) {
      trouble(`refused illegal receipt transition ${record.kind}${"receiptId" in record ? ` for ${record.receiptId}` : ""}`);
      return { accepted: false, landed: false };
    }
    const ids = recordReceiptIds(record);
    const forceMemory = policy.forceMemory === true || (ids.length > 0 && ids.every((id) => volatileReceipts.has(id)));
    let landed = false;
    if (core !== null && !forceMemory) landed = core.append(record);
    if (!landed && policy.failOpen !== true) return { accepted: false, landed: false };
    if (record.kind === "accepted" && !landed) volatileReceipts.add(record.receiptId);
    if (!apply(record)) return { accepted: false, landed };
    if (landed && !forceMemory) domainFailure = null;
    if (record.kind === "accepted" && landed) durableAccepted.add(record.receiptId);
    if (!landed) {
      for (const id of ids) if (durableAccepted.has(id)) incompleteDurableEvidence.add(id);
    }
    if (record.kind === "returned" && durableAccepted.has(record.receiptId)) {
      if (landed) unlandedReturns.delete(record.receiptId);
      else unlandedReturns.add(record.receiptId);
    }
    if (record.kind === "outcome") deleteMaterialFor(record.receiptId);
    if (record.kind === "withdrawn") for (const id of record.receiptIds) deleteMaterialFor(id);
    if (!recovering) maybeCompact();
    return { accepted: true, landed };
  };

  const materialPath = (receiptId: string): string | null => {
    if (!/^[a-zA-Z0-9._-]+$/.test(receiptId) || receiptId.includes("..")) return null;
    return join(options.dir, MATERIAL_DIR, `${receiptId}.json`);
  };
  const deleteMaterialFor = (receiptId: string): void => {
    materialMemory.delete(receiptId);
    if (options.memoryOnly) { pendingDeletion.delete(receiptId); return; }
    const path = materialPath(receiptId);
    if (path === null) return;
    let names: string[];
    try { names = readdirSync(join(options.dir, MATERIAL_DIR)); }
    catch (err) {
      pendingDeletion.add(receiptId);
      trouble(`could not inspect receipt material for ${receiptId}: ${errorText(err)}`);
      return;
    }
    const final = basename(path);
    const matching = names.filter((name) => name === final || name.startsWith(`${final}.tmp-`));
    if (!physicalWritable() || options.lock?.held === null || options.lock?.held === undefined
      || !stillOurs(options.lock.held, join(options.dir, "writer.lock"))) {
      if (matching.length > 0) pendingDeletion.add(receiptId);
      else pendingDeletion.delete(receiptId);
      return;
    }
    let failed = false;
    for (const name of matching) {
      try { deleteFile(join(options.dir, MATERIAL_DIR, name)); }
      catch (err) { failed = true; trouble(`could not delete receipt material ${name}: ${errorText(err)}`); }
    }
    if (failed) pendingDeletion.add(receiptId); else pendingDeletion.delete(receiptId);
  };
  const readMaterial = (receiptId: string): ReceiptMaterial | null => {
    const memory = materialMemory.get(receiptId);
    if (memory !== undefined) return memory;
    const path = materialPath(receiptId);
    if (path === null || !existsSync(path)) return null;
    try { return parseMaterial(readFileSync(path, "utf8")); } catch { return null; }
  };

  const retainedStates = (): ReceiptState[] => {
    const now = options.now();
    const keep = [...states.values()].filter((state) => isNonTerminal(state) || now - state.accepted.at <= RETENTION_MS);
    const keyed = keep.filter((state) => state.accepted.requestId !== null);
    const unkeyedLive = keep.filter((state) => state.accepted.requestId === null && isNonTerminal(state));
    const unkeyedTerminal = keep.filter((state) => state.accepted.requestId === null && !isNonTerminal(state))
      .sort((a, b) => b.accepted.at - a.accepted.at).slice(0, options.unkeyedTerminalCap ?? UNKEYED_TERMINAL_CAP);
    return [...keyed, ...unkeyedLive, ...unkeyedTerminal];
  };
  const rebuild = (kept: Set<string>, replacement: ReceiptRecord[]): void => {
    for (const id of [...durableAccepted]) if (!kept.has(id)) durableAccepted.delete(id);
    states.clear(); requestIds.clear(); records.splice(0); reservedQueue.clear(); reservedReceipts.clear(); generation = null;
    for (const record of replacement) {
      if (record.kind === "withdrawn") {
        const ids = record.receiptIds.filter((id) => kept.has(id));
        if (ids.length > 0) apply({ ...record, receiptIds: ids });
      } else if (record.kind === "generation" || kept.has(record.receiptId)) apply(record, durableAccepted.has("receiptId" in record ? record.receiptId : ""));
    }
  };
  const compact = (): boolean => {
    if (!unreadableSafeToCompact) {
      unreadableSafeToCompact = preserveUnreadable(core?.rawUnreadableLines() ?? []);
      if (!unreadableSafeToCompact) return false;
    }
    for (const id of [...pendingDeletion]) deleteMaterialFor(id);
    const retained = retainedStates();
    const kept = new Set(retained.map((state) => state.receiptId));
    const latestGeneration = [...records].reverse().find((record): record is GenerationReceiptRecord => record.kind === "generation");
    const replacement: ReceiptRecord[] = [];
    for (const record of records) {
      if (record.kind === "generation") continue;
      if (record.kind === "withdrawn") {
        const receiptIds = record.receiptIds.filter((id) => kept.has(id));
        if (receiptIds.length > 0) replacement.push({ ...record, receiptIds });
      } else if (kept.has(record.receiptId)) replacement.push(record);
    }
    if (latestGeneration !== undefined) replacement.push(latestGeneration);
    const physicalReplacement: ReceiptRecord[] = [];
    for (const record of replacement) {
      if (record.kind === "generation") {
        physicalReplacement.push(record);
      } else if (record.kind === "withdrawn") {
        const receiptIds = record.receiptIds.filter((id) => !volatileReceipts.has(id));
        if (receiptIds.length > 0) physicalReplacement.push({ ...record, receiptIds });
      } else if (!volatileReceipts.has(record.receiptId)) {
        physicalReplacement.push(record);
      }
    }
    if (core !== null && !core.replace(physicalReplacement)) return memoryFallback();
    if (core !== null) {
      unlandedReturns.clear();
      incompleteDurableEvidence.clear();
    }
    rebuild(kept, replacement);
    for (const id of [...volatileReceipts]) if (!kept.has(id)) volatileReceipts.delete(id);
    if (core !== null) {
      try { sizeAfterCompaction = statSync(core.file).size; } catch { sizeAfterCompaction = 0; }
    }
    return true;
  };
  const maybeCompact = (): void => {
    const expired = [...states.values()].some((state) => !isNonTerminal(state) && options.now() - state.accepted.at > RETENTION_MS);
    const excessUnkeyedTerminals = [...states.values()].filter(
      (state) => state.accepted.requestId === null && !isNonTerminal(state),
    ).length > (options.unkeyedTerminalCap ?? UNKEYED_TERMINAL_CAP);
    let oversized = false;
    if (core !== null) {
      try { oversized = statSync(core.file).size > Math.max(MIN_COMPACT_BYTES, 2 * sizeAfterCompaction); } catch { /* no file */ }
    }
    if (expired || excessUnkeyedTerminals || oversized) compact();
  };

  const conclude = (receiptId: string, arm: ReceiptOutcome): boolean => {
    const outcome: OutcomeReceiptRecord = { schema: 1, kind: "outcome", at: options.now(), receiptId, ...arm, why: arm.why.slice(0, MAX_WHY_CHARS) } as OutcomeReceiptRecord;
    return append(outcome).accepted;
  };

  const openRecover = (): void => {
    if (core === null) return;
    const raw = core.rawUnreadableLines();
    const blockedIds = new Set<string>();
    let blanket = false;
    for (const entry of core.entries()) {
      if (entry.kind === "record") {
        reserveRecordIds(entry.record);
        if (!apply(entry.record, true)) {
          illegalTransitions += 1;
          for (const id of recordReceiptIds(entry.record)) {
            if (states.has(id)) blockedIds.add(id);
            else recovery.orphanEvidence.push(id);
          }
        }
      } else {
        const envelope = parseEnvelope(entry.line);
        if (envelope.kind === "generation") { recovery.generationUnproven = true; continue; }
        if (envelope.receiptId !== null) {
          if (states.has(envelope.receiptId)) blockedIds.add(envelope.receiptId);
          else recovery.orphanEvidence.push(envelope.receiptId);
        } else {
          blanket = true;
        }
      }
    }
    const queueClaims = new Map<string, string[]>();
    const requestClaims = new Map<string, string[]>();
    for (const state of states.values()) {
      const itemId = state.accepted.queue?.itemId;
      if (itemId !== undefined) {
        const claimants = queueClaims.get(itemId) ?? [];
        claimants.push(state.receiptId);
        queueClaims.set(itemId, claimants);
      }
      const requestId = state.accepted.requestId;
      if (requestId !== null) {
        const claimants = requestClaims.get(requestId) ?? [];
        claimants.push(state.receiptId);
        requestClaims.set(requestId, claimants);
      }
    }
    for (const claimants of queueClaims.values()) if (claimants.length > 1) for (const id of claimants) blockedIds.add(id);
    for (const claimants of requestClaims.values()) if (claimants.length > 1) for (const id of claimants) blockedIds.add(id);
    for (const id of blockedIds) recoverySuppressed.add(id);
    recovery.blocked = blanket;
    recovery.reason = blanket ? "unreadable receipt evidence could hide an attempt for any restorable queued receipt" : null;

    /* THE BLANKET BLOCK COVERS DIRECT SENDS TOO. A direct send at `accepted`
       is "proven not attempted" only because nothing on disk says otherwise;
       malformed bytes could be its `attempted`, so under them it is concluded
       unknown rather than proven unsent. */
    const blanketBlocks = (state: ReceiptState): boolean =>
      blanket && (state.last.kind === "accepted" || state.last.kind === "returned");
    /* `attempted` is fail-closed for a durable receipt, so a direct send whose
       `accepted` is on disk and which never reached `attempted` was not typed. */
    const provenNotAttempted = (state: ReceiptState): boolean =>
      state.accepted.queue === null && state.last.kind === "accepted" && durableAccepted.has(state.receiptId);

    if (!physicalWritable()) {
      for (const state of states.values()) {
        if (blanketBlocks(state)) recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "recovery-blocked" });
        else if (blockedIds.has(state.receiptId) && isNonTerminal(state)) recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "recovery-blocked" });
        else if (state.last.kind === "attempted") recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "interrupted" });
        else if (provenNotAttempted(state)) recovery.wouldConclude.push({ receiptId: state.receiptId, state: "not-sent", reason: "interrupted-before-attempt" });
        else if ((state.last.kind === "accepted" || state.last.kind === "returned") && state.accepted.queue !== null && readMaterial(state.receiptId) === null)
          recovery.wouldConclude.push({ receiptId: state.receiptId, state: "not-sent", reason: "lost-at-restart" });
      }
      return;
    }
    recovering = true;
    const unreadablePreserved = preserveUnreadable(raw);
    unreadableSafeToCompact = unreadablePreserved;
    let conclusionsLanded = true;
    for (const state of [...states.values()]) {
      if (!isNonTerminal(state)) continue;
      if (blanketBlocks(state) || blockedIds.has(state.receiptId)) {
        if (conclude(state.receiptId, { state: "outcome-unknown", reason: "recovery-blocked", code: null, why: "unreadable receipt evidence could hide an attempt" })) {
          recovery.recoveryBlocked.push(state.receiptId);
        } else {
          conclusionsLanded = false;
          recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "recovery-blocked" });
        }
      } else if (state.last.kind === "attempted") {
        if (conclude(state.receiptId, { state: "outcome-unknown", reason: "interrupted", code: null, why: "the dashboard restarted after the attempt began" })) {
          recovery.interrupted.push(state.receiptId);
        } else {
          conclusionsLanded = false;
          recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "interrupted" });
        }
      } else if (provenNotAttempted(state)) {
        if (conclude(state.receiptId, { state: "not-sent", reason: "interrupted-before-attempt", code: null, why: "the dashboard restarted after this direct send was accepted and before it was attempted" })) {
          recovery.interruptedBeforeAttempt.push(state.receiptId);
        } else {
          conclusionsLanded = false;
          recovery.wouldConclude.push({ receiptId: state.receiptId, state: "not-sent", reason: "interrupted-before-attempt" });
        }
      } else if (state.accepted.queue !== null && readMaterial(state.receiptId) === null) {
        if (conclude(state.receiptId, { state: "not-sent", reason: "lost-at-restart", code: null, why: "the pinned queued material was missing at restart" })) {
          recovery.lostAtRestart.push(state.receiptId);
        } else {
          conclusionsLanded = false;
          recovery.wouldConclude.push({ receiptId: state.receiptId, state: "not-sent", reason: "lost-at-restart" });
        }
      }
    }
    cleanupOrphanMaterial();
    if (unreadablePreserved && conclusionsLanded) compact();
    recovering = false;
  };

  const preserveUnreadable = (lines: string[]): boolean => {
    if (lines.length === 0) return true;
    if (options.memoryOnly || !physicalWritable()) return false;
    const lock = options.lock;
    if (lock?.held !== undefined && lock.held !== null && !stillOurs(lock.held, join(options.dir, "writer.lock"))) {
      recoveryFailure = "could not preserve unreadable receipts because the shared writer lock was lost";
      trouble(recoveryFailure); return false;
    }
    const path = join(options.dir, UNREADABLE_RECEIPTS_FILE);
    let fd: number;
    try { fd = openSync(path, "a", 0o600); }
    catch (err) {
      recoveryFailure = `could not open ${path}: ${errorText(err)}`;
      trouble(recoveryFailure); return false;
    }
    let wrote = true;
    try { writeAll(fd, `${lines.join("\n")}\n`); }
    catch (err) {
      wrote = false;
      recoveryFailure = `could not preserve unreadable receipts in ${path}: ${errorText(err)}`;
      trouble(recoveryFailure);
    }
    finally { closeSync(fd); }
    if (wrote) recoveryFailure = null;
    return wrote;
  };

  const cleanupOrphanMaterial = (): void => {
    if (options.memoryOnly) return;
    const liveMaterial = new Set([...states.values()].filter(isNonTerminal).map((state) => state.receiptId));
    let names: string[];
    try { names = readdirSync(join(options.dir, MATERIAL_DIR)); }
    catch (err) { trouble(`could not inspect receipt material directory: ${errorText(err)}`); return; }
    for (const name of names) {
      const match = /^(.*)\.json(?:\.tmp-.*)?$/.exec(name);
      if (match?.[1] === undefined || liveMaterial.has(match[1])) continue;
      try { deleteFile(join(options.dir, MATERIAL_DIR, name)); }
      catch (err) { pendingDeletion.add(match[1]); trouble(`could not delete orphan receipt material ${name}: ${errorText(err)}`); }
    }
    for (const state of states.values()) if (!isNonTerminal(state)) deleteMaterialFor(state.receiptId);
  };

  const api: InternalJournal = {
    accept(input) {
      if ([...states.values()].some((state) => !isNonTerminal(state) && options.now() - state.accepted.at > RETENTION_MS)) compact();
      if (input.requestId !== null && requestIds.has(input.requestId)) {
        return { ok: false, why: `request id ${input.requestId} already has a receipt` };
      }
      const keyedCount = [...states.values()].filter((state) => state.accepted.requestId !== null).length;
      if (input.requestId !== null && keyedCount >= (options.keyedReceiptCap ?? KEYED_RECEIPT_CAP)) return { ok: false, why: "the receipt journal already retains 5,000 keyed receipts" };
      if (api.nonTerminal().length >= (options.nonTerminalCap ?? NON_TERMINAL_CAP)) return { ok: false, why: "the receipt journal already has 1,000 non-terminal receipts" };
      if ((input.requestId === null) !== (input.fingerprint === null)) return { ok: false, why: "requestId and fingerprint must either both be present or both be null" };
      let receiptId: string;
      do {
        if (receiptSequence >= Number.MAX_SAFE_INTEGER) receiptSequence = 0;
        receiptSequence += 1;
        receiptId = `${options.serverInstanceId}-r${receiptSequence}`;
      } while (reservedReceipts.has(receiptId));
      reservedReceipts.add(receiptId);
      let materialVolatile = false;
      if (input.material !== undefined && !api.putMaterial(receiptId, input.material)) {
        if (input.requestId !== null) return { ok: false, why: `could not pin material for ${receiptId}` };
        materialMemory.set(receiptId, input.material);
        materialVolatile = true;
      }
      const { material: _material, parentReceiptId, ...fields } = input;
      // The input type already pairs op and target; `append` re-parses the line, so a
      // pairing that slipped past the type is refused rather than written.
      const record = {
        schema: 1, kind: "accepted", at: options.now(), receiptId, serverInstanceId: options.serverInstanceId,
        ...fields, parentReceiptId: parentReceiptId ?? null, what: input.what.slice(0, MAX_WHAT_CHARS),
      } as AcceptedReceiptRecord;
      const result = append(record, { failOpen: input.requestId === null, forceMemory: materialVolatile });
      if (!result.accepted) {
        if (input.material !== undefined) deleteMaterialFor(receiptId);
        return { ok: false, why: domainFailure ?? core?.status().failure ?? "the accepted receipt did not land" };
      }
      return { ok: true, receiptId, durable: durableAccepted.has(receiptId) };
    },
    putMaterial(receiptId, payload) {
      if (materialPath(receiptId) === null) { trouble(`refused unsafe receipt id ${JSON.stringify(receiptId)} for material`); return false; }
      if (parseMaterial(JSON.stringify(payload)) === null) { trouble(`refused invalid receipt material for ${receiptId}`); return false; }
      if (options.memoryOnly || memoryFallback()) { materialMemory.set(receiptId, payload); return true; }
      if (options.lock?.held === null || options.lock?.held === undefined
        || !stillOurs(options.lock.held, join(options.dir, "writer.lock"))) {
        trouble("could not write receipt material because this process no longer holds writer.lock");
        return false;
      }
      const directory = join(options.dir, MATERIAL_DIR);
      const path = join(directory, `${receiptId}.json`);
      try {
        writePrivateAtomically(path, directory, `${JSON.stringify(payload)}\n`);
        domainFailure = null;
        return true;
      } catch (err) {
        trouble(`could not write receipt material ${path}: ${errorText(err)}`);
        deleteMaterialFor(receiptId);
        return false;
      }
    },
    attempted(receiptId) {
      /* A failed `returned` is safe by itself: disk still says attempted, so a
         restart will not retry it. Before another attempt, however, the disk
         fold must catch up. Otherwise the new attempted line is illegal on
         restart, and a later successful cancel cannot remain withdrawn. */
      if (unlandedReturns.has(receiptId)) {
        if (!api.compact() || unlandedReturns.has(receiptId)) return { landed: false };
      }
      const result = append(
        { schema: 1, kind: "attempted", at: options.now(), receiptId },
        { failOpen: !durableAccepted.has(receiptId) },
      );
      return { landed: result.accepted };
    },
    progress(receiptId, step, status, verdict) {
      return append(
        { schema: 1, kind: "progress", at: options.now(), receiptId, step, status, verdict: verdict.slice(0, MAX_VERDICT_CHARS) },
        { failOpen: true, forceMemory: incompleteDurableEvidence.has(receiptId) },
      ).accepted;
    },
    returned(receiptId, code) {
      return append({ schema: 1, kind: "returned", at: options.now(), receiptId, code }, { failOpen: true }).accepted;
    },
    outcome(receiptId, arm) {
      return append(
        { schema: 1, kind: "outcome", at: options.now(), receiptId, ...arm, why: arm.why.slice(0, MAX_WHY_CHARS) } as OutcomeReceiptRecord,
        { failOpen: true },
      ).accepted;
    },
    withdrawn(receiptIds, reason, by) {
      const at = options.now();
      const durableIds = receiptIds.filter((id) => !volatileReceipts.has(id));
      const volatileIds = receiptIds.filter((id) => volatileReceipts.has(id));
      if (durableIds.length > 0) {
        /* Same repair as `attempted`: withdrawal is write-ahead, so it may not
           claim success on top of an on-disk attempted line when memory alone
           contains the proven-unsent return. */
        if (durableIds.some((id) => unlandedReturns.has(id))) {
          if (!api.compact() || durableIds.some((id) => unlandedReturns.has(id))) return false;
        }
        const durable = append({ schema: 1, kind: "withdrawn", at, receiptIds: durableIds, reason, actor: by });
        if (!durable.accepted) return false;
      }
      if (volatileIds.length > 0) {
        return append(
          { schema: 1, kind: "withdrawn", at, receiptIds: volatileIds, reason, actor: by },
          { failOpen: true, forceMemory: true },
        ).accepted;
      }
      return durableIds.length > 0;
    },
    reconcile(receiptId, disposition, by) {
      return append(
        { schema: 1, kind: "reconciled", at: options.now(), receiptId, disposition, actor: by },
        { failOpen: true },
      ).accepted;
    },
    noteGeneration(pid) {
      if (!Number.isInteger(pid) || pid <= 0 || pid === generation) return;
      append({ schema: 1, kind: "generation", at: options.now(), pid }, { failOpen: true });
    },
    lastGeneration: () => generation,
    get: (receiptId) => states.has(receiptId) ? view(states.get(receiptId)!) : null,
    byRequestId(requestId) { const id = requestIds.get(requestId); return id === undefined ? null : api.get(id); },
    childrenOf(parentReceiptId) { return [...states.values()].filter((state) => state.accepted.parentReceiptId === parentReceiptId).map(view); },
    recent(limit) { return [...states.values()].sort((a, b) => b.accepted.at - a.accepted.at || b.receiptId.localeCompare(a.receiptId)).slice(0, Math.max(0, limit)).map(view); },
    forSession(sessionId) { return [...states.values()].filter((state) => state.accepted.target?.sessionId === sessionId).map(view); },
    nonTerminal: () => [...states.values()].filter(isNonTerminal).map(view),
    restorable() {
      const result: RestorableItem[] = [];
      for (const state of states.values()) {
        if (recoverySuppressed.has(state.receiptId)) continue;
        if (!(state.last.kind === "accepted" || state.last.kind === "returned") || state.accepted.queue === null) continue;
        const target = state.accepted.target;
        if (target === null) continue;
        const material = readMaterial(state.receiptId);
        if (material === null) continue;
        result.push({ receiptId: state.receiptId, op: state.accepted.op, origin: state.accepted.origin,
          actor: state.accepted.actor, speaker: state.accepted.speaker, target,
          what: state.accepted.what, queue: state.accepted.queue, material, tmuxGeneration: target.tmuxGeneration });
      }
      return result;
    },
    unknownKeystrokeReceipts: () => [...states.values()].filter(isUnknown).map(view),
    durable: () => physicalWritable() && core!.status().failure === null
      && domainFailure === null && recoveryFailure === null
      && unlandedReturns.size === 0
      && incompleteDurableEvidence.size === 0
      && ![...volatileReceipts].some((id) => {
        const state = states.get(id);
        return state !== undefined && isNonTerminal(state);
      }),
    acceptedDurably: (receiptId) => durableAccepted.has(receiptId),
    evidenceDurable: (receiptId) => durableAccepted.has(receiptId) && !incompleteDurableEvidence.has(receiptId),
    reservedQueueItemIds: () => [...reservedQueue],
    compact,
    recovery: () => ({ ...recovery, interrupted: [...recovery.interrupted], interruptedBeforeAttempt: [...recovery.interruptedBeforeAttempt], lostAtRestart: [...recovery.lostAtRestart], recoveryBlocked: [...recovery.recoveryBlocked], orphanEvidence: [...recovery.orphanEvidence], wouldConclude: [...recovery.wouldConclude] }),
    status: () => {
      const status = core?.status();
      return {
        dir: options.dir, file: status?.file ?? null,
        lockedOutBy: status?.lockedOutBy ?? (options.memoryOnly ? "the receipt journal was never opened" : null),
        failure: recoveryFailure ?? domainFailure ?? status?.failure ?? null,
        unreadableLines: status?.unreadableLines ?? 0,
        repaired: status?.repaired ?? { torn: false }, compactions: status?.compactions ?? 0,
        illegalTransitions, materialDeletionPending: [...pendingDeletion].sort(),
        keyedReceipts: [...states.values()].filter((state) => state.accepted.requestId !== null).length,
        nonTerminalReceipts: [...states.values()].filter(isNonTerminal).length,
        neverOpened: options.memoryOnly,
      };
    },
    close: () => core?.close(),
    openRecover,
  };
  return api;
}

function parseEnvelope(line: string): { kind: string | null; receiptId: string | null } {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return { kind: null, receiptId: null }; }
  if (!object(value) || value["schema"] !== 1 || typeof value["kind"] !== "string") return { kind: null, receiptId: null };
  if (value["kind"] === "generation") return { kind: "generation", receiptId: null };
  if (!ACTION_KINDS.has(value["kind"])) return { kind: null, receiptId: null };
  return { kind: value["kind"], receiptId: typeof value["receiptId"] === "string" && value["receiptId"] !== "" ? value["receiptId"] : null };
}

function parseMaterial(text: string): ReceiptMaterial | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!object(value) || !SPEAKERS.includes(value["speaker"] as Speaker)) return null;
  if (value["kind"] === "message" && exact(value, ["kind", "text", "speaker"]) && typeof value["text"] === "string") return value as ReceiptMaterial;
  if (value["kind"] === "action" && exact(value, ["kind", "action", "speaker"]) && spokenAction(value["action"])) return value as ReceiptMaterial;
  return null;
}

function spokenAction(value: unknown): value is SpokenAction {
  return object(value)
    && exact(value, ["effect", "id", "scope", "label", "summary", "text", "form", "needsConfirm"])
    && value["effect"] === "spoken"
    && string(value["id"])
    && value["scope"] === "session"
    && typeof value["label"] === "string"
    && typeof value["summary"] === "string"
    && typeof value["text"] === "string"
    && (value["form"] === "prose" || value["form"] === "slash-command")
    && typeof value["needsConfirm"] === "boolean";
}

export function reservedQueueItemIds(journal: ReceiptJournal): string[] { return journal.reservedQueueItemIds(); }

/**
 * The receipt arm for one coordinator reading of a direct send — the same
 * mapping Stage 2's direct steer records (`routes-steer.ts`): `held` is
 * `not-sent`/`session-held`, `ok` is `keys-submitted`, `unsent` is `not-sent`,
 * anything else ambiguous is `outcome-unknown`. Both broadcast loops settle their
 * recipients through this, so a recipient cannot be recorded differently from a
 * steer. The coordinator's `unsent` is the one licence for `not-sent`.
 */
export function sendAttemptOutcome(attempt: SendAttempt): ReceiptOutcome {
  if (attempt.kind === "held") {
    return { state: "not-sent", reason: "session-held", code: "session-held", why: "the session was held, so the coordinator refused before the transport" };
  }
  if (attempt.kind === "threw") {
    return { state: "outcome-unknown", reason: "threw", code: null, why: "the delivery module threw and could not establish whether any keystroke was sent" };
  }
  const result = attempt.result;
  if (result.ok) return { state: "keys-submitted", reason: "transport-ok", code: null, why: "the transport submitted every key" };
  if (attempt.unsent !== null) {
    return { state: "not-sent", reason: "transport-refused-unsent", code: result.reason.code, why: "the transport refused before any keystroke left this process" };
  }
  const reading = result.delivery === "partial" ? "partial" : result.delivery === "unknown" ? "unknown" : "none-contradicted";
  return {
    state: "outcome-unknown",
    reason: reading,
    code: result.reason.code,
    why: `the transport's reading was '${reading}', so what reached the input box cannot be told`,
  };
}

/** One direct recipient of a broadcast, as its own child receipt (Stage 3). */
export type RecipientReceipt = {
  parentReceiptId: string;
  actor: ReceiptActor;
  speaker: Speaker | null;
  target: ReceiptTarget;
  what: string;
};

/**
 * Accept and attempt one direct recipient's child receipt, on the line above
 * its send — the one way both broadcast loops do it. Unkeyed (the parent carries
 * the request id), so the accept is fail-open; `attempted` is fail-closed when
 * the accept landed durably. `ok: false` means nothing may be sent to this
 * recipient, and where a receipt exists it already says
 * `not-sent`/`attempt-not-recorded`.
 */
export function beginRecipientReceipt(
  journal: ReceiptJournal,
  child: RecipientReceipt,
): { ok: true; receiptId: string } | { ok: false; why: string } {
  const accepted = journal.accept({ requestId: null, fingerprint: null, op: "broadcast-recipient", origin: "broadcast", queue: null, ...child });
  if (!accepted.ok) {
    return { ok: false, why: `nothing was sent to this recipient: it could not be given a receipt first (${accepted.why})` };
  }
  if (!journal.attempted(accepted.receiptId).landed) {
    journal.outcome(accepted.receiptId, {
      state: "not-sent",
      reason: "attempt-not-recorded",
      code: null,
      why: "the record that this send was being attempted could not be written, so nothing was sent",
    });
    return { ok: false, why: "nothing was sent to this recipient: the record that it was being attempted could not be written" };
  }
  return { ok: true, receiptId: accepted.receiptId };
}

/**
 * A recipient the fan-out's deadline cut off: accounted for by a child that was
 * never attempted, `not-sent`/`not-reached`. False when it could not be recorded.
 */
export function recordUnreachedRecipient(journal: ReceiptJournal, child: RecipientReceipt): boolean {
  return recordUnattemptedRecipient(journal, child, {
    state: "not-sent",
    reason: "not-reached",
    code: null,
    why: "the fan-out passed its deadline before this recipient",
  });
}

/** A broadcast recipient proved unsent without entering the transport. */
export function recordUnattemptedRecipient(
  journal: ReceiptJournal,
  child: RecipientReceipt,
  outcome: NotSentOutcome,
): boolean {
  const accepted = journal.accept({
    requestId: null,
    fingerprint: null,
    op: "broadcast-recipient",
    origin: "broadcast",
    queue: null,
    ...child,
  });
  return accepted.ok && journal.outcome(accepted.receiptId, outcome);
}

/**
 * A broadcast parent's `why`: its children counted by state, and how many of
 * their receipts are not durable. Counts only, never a word of what was said.
 * A queued child still waiting is counted as `queued`, not by its `accepted`.
 */
export function describeChildren(journal: ReceiptJournal, parentReceiptId: string): string {
  const children = journal.childrenOf(parentReceiptId);
  const counts = new Map<string, number>();
  let notDurable = 0;
  for (const child of children) {
    const summary = summarizeReceipt(child);
    const label = child.accepted.queue !== null && summary.pending ? "queued" : summary.state;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (!journal.acceptedDurably(child.receiptId)) notDurable += 1;
  }
  const parts = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, n]) => `${label} ${n}`);
  return (
    `${children.length} recipient receipt(s): ${parts.length === 0 ? "none" : parts.join(", ")}` +
    (notDurable > 0 ? `; ${notDurable} not durable` : "")
  ).slice(0, MAX_WHY_CHARS);
}

/**
 * A broadcast parent is no more certain than its least certain child. Queued
 * children may remain pending: their durable acceptance is the broadcast's
 * completed act for that recipient, while delivery keeps its own lifecycle.
 */
export function broadcastParentOutcome(
  journal: ReceiptJournal,
  parentReceiptId: string,
  expectedChildren: number,
): ReceiptOutcome {
  const children = journal.childrenOf(parentReceiptId);
  const uncertain = children.length !== expectedChildren || children.some((child) => {
    if (!(journal.evidenceDurable?.(child.receiptId) ?? journal.acceptedDurably(child.receiptId))) return true;
    const summary = summarizeReceipt(child);
    if (summary.state === "outcome-unknown") return true;
    return child.accepted.queue === null && summary.pending;
  });
  const description = describeChildren(journal, parentReceiptId);
  if (uncertain) {
    return {
      state: "outcome-unknown",
      reason: "unknown",
      code: null,
      why: `${description}; expected ${expectedChildren}; at least one recipient lacks durable settled evidence`.slice(0, MAX_WHY_CHARS),
    };
  }
  return { state: "completed", reason: "fan-out-finished", code: null, why: description };
}

/**
 * One receipt as the wire shows it: text-free, and saying whether it is still
 * pending. The read route's list and a request-id replay both answer with it,
 * so the two cannot describe one receipt differently.
 */
export function summarizeReceipt(receipt: ReceiptState): ReceiptSummary {
  let attemptedAt: number | null = null;
  let outcomeAt: number | null = null;
  let reconciled = false;
  let reconciliation: ReceiptSummary["reconciliation"] = null;
  let state: ReceiptSummary["state"] = "accepted";
  let reason: string | null = null;
  let steps = 0;
  for (const record of receipt.records) {
    if (record.kind === "progress") steps += 1;
    if (record.kind === "attempted") attemptedAt = record.at;
    if (record.kind === "outcome") {
      outcomeAt = record.at;
      state = record.state;
      reason = record.reason;
    }
    if (record.kind === "reconciled") {
      reconciled = true;
      /* WHO SAID WHAT, AND WHEN — beside the outcome, never instead of it.
         `state` above is read only off outcome records, so a statement cannot
         turn an unknown into anything else. */
      reconciliation = { disposition: record.disposition, actor: { ...record.actor }, at: record.at };
    }
  }
  if (outcomeAt === null) {
    if (receipt.last.kind === "attempted") state = "attempted";
    else if (receipt.last.kind === "returned") {
      state = "returned";
      reason = receipt.last.code;
    } else if (receipt.last.kind === "withdrawn") {
      state = "withdrawn";
      reason = receipt.last.reason;
    }
  }
  return {
    receiptId: receipt.receiptId,
    op: receipt.accepted.op,
    origin: receipt.accepted.origin,
    pending: receipt.last.kind === "accepted" || receipt.last.kind === "attempted" || receipt.last.kind === "returned",
    actor: { ...receipt.accepted.actor },
    speaker: receipt.accepted.speaker,
    target: receipt.accepted.target === null ? null : { ...receipt.accepted.target },
    parentReceiptId: receipt.accepted.parentReceiptId,
    /* The steps of an enacted plan KNOWN to have finished — one per progress
       record, whatever its gate said. A crash mid-plan reports exactly these. */
    stepsCompleted: isEnactedOp(receipt.accepted.op) ? steps : null,
    what: receipt.accepted.what,
    acceptedAt: receipt.accepted.at,
    state,
    reason,
    attemptedAt,
    outcomeAt,
    reconciled,
    reconciliation,
    queueItemId: receipt.accepted.queue?.itemId ?? null,
    materialDeletionPending: receipt.materialDeletionPending,
  };
}

/** Atomic material writes are private from the first temporary byte, not only after rename. */
function writePrivateAtomically(path: string, directory: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeAll(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  try {
    const dir = openSync(directory, "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } catch {
    // The content and rename succeeded; directory fsync is not portable.
  }
}

function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function currentRunReceiptSuffix(receiptId: string, serverInstanceId: string): number | null {
  const match = new RegExp(`^${escapeRegExp(serverInstanceId)}-r([0-9]+)$`).exec(receiptId);
  if (match?.[1] === undefined) return null;
  const suffix = Number(match[1]);
  return Number.isSafeInteger(suffix) && suffix >= 0 && suffix < Number.MAX_SAFE_INTEGER ? suffix : null;
}
function errorText(err: unknown): string { return err instanceof Error ? err.message : String(err); }
