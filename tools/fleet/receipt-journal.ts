/**
 * Durable evidence for actions accepted by the fleet dashboard.
 *
 * The journal records evidence, not optimism: submitting every tmux key is the
 * strongest transport claim available here, and an ambiguous attempt is never
 * retried automatically. Message text lives only in short-lived material
 * files, never in this JSONL history.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

import { writeAll, writeAtomically, type JsonlRepair } from "../overseer/jsonl.js";
import { stillOurs } from "../overseer/lock.js";
import type { SpokenAction } from "./actions.js";
import {
  openJournalFile,
  type JournalFile,
  type SharedJournalLock,
} from "./journal-file.js";
import type { Speaker } from "./wire.js";

export const RECEIPTS_FILE = "receipts.jsonl";
export const UNREADABLE_RECEIPTS_FILE = "receipts.unreadable.jsonl";
export const MATERIAL_DIR = "material";
export const MAX_WHAT_CHARS = 200;
export const MAX_WHY_CHARS = 500;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const REQUEST_ID_SKEW_MS = 60 * 60 * 1_000;
export const KEYED_RECEIPT_CAP = 5_000;
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
export type ReceiptOp = "queued-message" | "queued-action";
export type ReceiptOrigin = "enqueue" | "broadcast";
export type ReceiptTarget = {
  sessionId: string;
  paneId: string | null;
  claudeSessionId: string | null;
  tmuxGeneration: number | null;
};
export type ReceiptQueue = { itemId: string; enqueuedAt: number };

type RecordBase<K extends string> = { schema: 1; kind: K; at: number };
export type AcceptedReceiptRecord = RecordBase<"accepted"> & {
  receiptId: string;
  requestId: string | null;
  fingerprint: string | null;
  op: ReceiptOp;
  origin: ReceiptOrigin;
  actor: ReceiptActor;
  speaker: Speaker | null;
  target: ReceiptTarget;
  what: string;
  serverInstanceId: string;
  queue: ReceiptQueue | null;
};
export type AttemptedReceiptRecord = RecordBase<"attempted"> & { receiptId: string };
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
    | "tmux-generation-unproven";
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
export type ReceiptOutcome = KeysSubmittedOutcome | NotSentOutcome | UnknownOutcome;
export type OutcomeReceiptRecord = RecordBase<"outcome"> & { receiptId: string } & ReceiptOutcome;
export type ReconciledReceiptRecord = RecordBase<"reconciled"> & {
  receiptId: string;
  disposition: "lease-abandoned";
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
  | GenerationReceiptRecord;

export type ReceiptMaterial =
  | { kind: "message"; text: string; speaker: Speaker }
  | { kind: "action"; action: SpokenAction; speaker: Speaker };

export type AcceptReceiptInput = Omit<
  AcceptedReceiptRecord,
  "schema" | "kind" | "at" | "receiptId" | "serverInstanceId" | "what"
> & {
  what: string;
  /** Preferred production path: the store pins this before writing accepted. */
  material?: ReceiptMaterial | undefined;
};

export type ReceiptState = {
  receiptId: string;
  accepted: AcceptedReceiptRecord;
  last: Exclude<ReceiptRecord, AcceptedReceiptRecord | GenerationReceiptRecord> | AcceptedReceiptRecord;
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
  returned(receiptId: string, code: string): boolean;
  outcome(receiptId: string, arm: ReceiptOutcome): boolean;
  withdrawn(receiptIds: string[], reason: "cancelled" | "cleared", actor: ReceiptActor): boolean;
  reconcile(receiptId: string, disposition: "lease-abandoned", actor: ReceiptActor): boolean;
  noteGeneration(pid: number): void;
  lastGeneration(): number | null;
  get(receiptId: string): ReceiptState | null;
  byRequestId(requestId: string): ReceiptState | null;
  recent(limit: number): ReceiptState[];
  forSession(sessionId: string): ReceiptState[];
  nonTerminal(): ReceiptState[];
  restorable(): RestorableItem[];
  unknownKeystrokeReceipts(): ReceiptState[];
  durable(): boolean;
  acceptedDurably(receiptId: string): boolean;
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
const OPS: readonly ReceiptOp[] = ["queued-message", "queued-action"];
const ORIGINS: readonly ReceiptOrigin[] = ["enqueue", "broadcast"];
const ACTOR_KINDS: readonly ReceiptActor["kind"][] = ["client-claimed", "unattributed-http", "system"];
const NOT_SENT_REASONS: readonly NotSentOutcome["reason"][] = [
  "transport-refused-unsent", "session-held", "undeliverable", "lost-at-restart",
  "tmux-generation-changed", "tmux-generation-unproven",
];
const UNKNOWN_REASONS: readonly UnknownOutcome["reason"][] = [
  "partial", "unknown", "none-contradicted", "threw", "interrupted", "lease-abandoned", "recovery-blocked",
];
const ACTION_KINDS = new Set(["accepted", "attempted", "returned", "outcome", "reconciled", "withdrawn"]);

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
    if (!exact(value, ["schema", "kind", "at", "receiptId", "requestId", "fingerprint", "op", "origin", "actor", "speaker", "target", "what", "serverInstanceId", "queue"])
      || !nullableString(value["requestId"]) || !nullableString(value["fingerprint"])
      || ((value["requestId"] === null) !== (value["fingerprint"] === null))
      || !OPS.includes(value["op"] as ReceiptOp) || !ORIGINS.includes(value["origin"] as ReceiptOrigin)
      || !actor(value["actor"]) || !(value["speaker"] === null || SPEAKERS.includes(value["speaker"] as Speaker))
      || !target(value["target"]) || typeof value["what"] !== "string" || value["what"].length > MAX_WHAT_CHARS
      || !string(value["serverInstanceId"]) || !queue(value["queue"])) return null;
    return { ...base, kind: "accepted", receiptId, requestId: value["requestId"] as string | null,
      fingerprint: value["fingerprint"] as string | null, op: value["op"] as ReceiptOp, origin: value["origin"] as ReceiptOrigin,
      actor: value["actor"], speaker: value["speaker"] as Speaker | null, target: value["target"],
      what: value["what"].slice(0, MAX_WHAT_CHARS), serverInstanceId: value["serverInstanceId"], queue: value["queue"] };
  }
  if (value["kind"] === "attempted") {
    return exact(value, ["schema", "kind", "at", "receiptId"]) ? { ...base, kind: "attempted", receiptId } : null;
  }
  if (value["kind"] === "returned") {
    return exact(value, ["schema", "kind", "at", "receiptId", "code"]) && string(value["code"])
      ? { ...base, kind: "returned", receiptId, code: value["code"] } : null;
  }
  if (value["kind"] === "reconciled") {
    return exact(value, ["schema", "kind", "at", "receiptId", "disposition", "actor"])
      && value["disposition"] === "lease-abandoned" && actor(value["actor"])
      ? { ...base, kind: "reconciled", receiptId, disposition: "lease-abandoned", actor: value["actor"] } : null;
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
    closedBy: "this receipt journal has been closed",
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
  const materialMemory = new Map<string, ReceiptMaterial>();
  const pendingDeletion = new Set<string>();
  const records: ReceiptRecord[] = [];
  const deleteFile = options.deleteMaterial ?? unlinkSync;
  const recovery: RecoverySummary = {
    blocked: false, reason: null, generationUnproven: false, interrupted: [], lostAtRestart: [],
    recoveryBlocked: [], orphanEvidence: [], wouldConclude: [],
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
    if (record.kind === "outcome") {
      if (state.last.kind === "attempted") return true;
      if (state.last.kind === "accepted" || state.last.kind === "returned") {
        return record.state === "not-sent" || (record.state === "outcome-unknown" && record.reason === "recovery-blocked");
      }
      return false;
    }
    return record.kind === "reconciled" && isUnknown(state);
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
      const match = new RegExp(`^${escapeRegExp(options.serverInstanceId)}-r([0-9]+)$`).exec(record.receiptId);
      if (match?.[1] !== undefined) receiptSequence = Math.max(receiptSequence, Number(match[1]));
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
      const match = new RegExp(`^${escapeRegExp(options.serverInstanceId)}-r([0-9]+)$`).exec(id);
      if (match?.[1] !== undefined) receiptSequence = Math.max(receiptSequence, Number(match[1]));
    }
    if (record.kind === "accepted" && record.queue !== null) reservedQueue.add(record.queue.itemId);
  };

  const append = (record: ReceiptRecord): boolean => {
    if (parseReceiptLine(receiptLine(record)) === null) {
      trouble(`refused invalid ${record.kind} receipt record`);
      return false;
    }
    const state = record.kind === "withdrawn" || record.kind === "generation" ? undefined : states.get(record.receiptId);
    if (!validTransition(state, record)) {
      trouble(`refused illegal receipt transition ${record.kind}${"receiptId" in record ? ` for ${record.receiptId}` : ""}`);
      return false;
    }
    let landed = false;
    if (core !== null) landed = core.append(record);
    if (!landed && !memoryFallback()) return false;
    if (!apply(record)) return false;
    domainFailure = null;
    if (record.kind === "accepted" && landed) durableAccepted.add(record.receiptId);
    if (record.kind === "outcome") deleteMaterialFor(record.receiptId);
    if (record.kind === "withdrawn") for (const id of record.receiptIds) deleteMaterialFor(id);
    if (!recovering) maybeCompact();
    return true;
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
      .sort((a, b) => b.accepted.at - a.accepted.at).slice(0, options.unkeyedTerminalCap ?? KEYED_RECEIPT_CAP);
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
    if (core !== null && !core.replace(replacement)) return memoryFallback();
    rebuild(kept, replacement);
    if (core !== null) {
      try { sizeAfterCompaction = statSync(core.file).size; } catch { sizeAfterCompaction = 0; }
    }
    return true;
  };
  const maybeCompact = (): void => {
    const expired = [...states.values()].some((state) => !isNonTerminal(state) && options.now() - state.accepted.at > RETENTION_MS);
    let oversized = false;
    if (core !== null) {
      try { oversized = statSync(core.file).size > Math.max(MIN_COMPACT_BYTES, 2 * sizeAfterCompaction); } catch { /* no file */ }
    }
    if (expired || oversized) compact();
  };

  const conclude = (receiptId: string, arm: ReceiptOutcome): boolean => {
    const outcome: OutcomeReceiptRecord = { schema: 1, kind: "outcome", at: options.now(), receiptId, ...arm, why: arm.why.slice(0, MAX_WHY_CHARS) } as OutcomeReceiptRecord;
    const landed = append(outcome);
    return landed;
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
          if (entry.record.kind === "accepted" && states.has(entry.record.receiptId)) blockedIds.add(entry.record.receiptId);
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
    for (const state of states.values()) {
      const itemId = state.accepted.queue?.itemId;
      if (itemId === undefined) continue;
      const claimants = queueClaims.get(itemId) ?? [];
      claimants.push(state.receiptId);
      queueClaims.set(itemId, claimants);
    }
    for (const claimants of queueClaims.values()) if (claimants.length > 1) for (const id of claimants) blockedIds.add(id);
    recovery.blocked = blanket;
    recovery.reason = blanket ? "unreadable receipt evidence could hide an attempt for any restorable queued receipt" : null;

    if (!physicalWritable()) {
      for (const state of states.values()) {
        const globallyBlocked = blanket && state.accepted.queue !== null
          && (state.last.kind === "accepted" || state.last.kind === "returned");
        if (globallyBlocked) recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "recovery-blocked" });
        else if (blockedIds.has(state.receiptId) && isNonTerminal(state)) recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "recovery-blocked" });
        else if (state.last.kind === "attempted") recovery.wouldConclude.push({ receiptId: state.receiptId, state: "outcome-unknown", reason: "interrupted" });
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
      const globallyBlocked = blanket && state.accepted.queue !== null
        && (state.last.kind === "accepted" || state.last.kind === "returned");
      if (globallyBlocked || blockedIds.has(state.receiptId)) {
        if (conclude(state.receiptId, { state: "outcome-unknown", reason: "recovery-blocked", code: null, why: "unreadable receipt evidence could hide an attempt" })) {
          recovery.recoveryBlocked.push(state.receiptId);
        } else {
          conclusionsLanded = false;
        }
      } else if (state.last.kind === "attempted") {
        if (conclude(state.receiptId, { state: "outcome-unknown", reason: "interrupted", code: null, why: "the dashboard restarted after the attempt began" })) {
          recovery.interrupted.push(state.receiptId);
        } else {
          conclusionsLanded = false;
        }
      } else if (state.accepted.queue !== null && readMaterial(state.receiptId) === null) {
        if (conclude(state.receiptId, { state: "not-sent", reason: "lost-at-restart", code: null, why: "the pinned queued material was missing at restart" })) {
          recovery.lostAtRestart.push(state.receiptId);
        } else {
          conclusionsLanded = false;
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
      const keyedCount = [...states.values()].filter((state) => state.accepted.requestId !== null).length;
      if (input.requestId !== null && keyedCount >= (options.keyedReceiptCap ?? KEYED_RECEIPT_CAP)) return { ok: false, why: "the receipt journal already retains 5,000 keyed receipts" };
      if (api.nonTerminal().length >= (options.nonTerminalCap ?? NON_TERMINAL_CAP)) return { ok: false, why: "the receipt journal already has 1,000 non-terminal receipts" };
      if ((input.requestId === null) !== (input.fingerprint === null)) return { ok: false, why: "requestId and fingerprint must either both be present or both be null" };
      let receiptId: string;
      do { receiptSequence += 1; receiptId = `${options.serverInstanceId}-r${receiptSequence}`; } while (reservedReceipts.has(receiptId));
      reservedReceipts.add(receiptId);
      if (input.material !== undefined && !api.putMaterial(receiptId, input.material)) return { ok: false, why: `could not pin material for ${receiptId}` };
      const { material: _material, ...fields } = input;
      const record: AcceptedReceiptRecord = {
        schema: 1, kind: "accepted", at: options.now(), receiptId, serverInstanceId: options.serverInstanceId,
        ...fields, what: input.what.slice(0, MAX_WHAT_CHARS),
      };
      if (!append(record)) return { ok: false, why: domainFailure ?? core?.status().failure ?? "the accepted receipt did not land" };
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
        writeAtomically(path, directory, `${JSON.stringify(payload)}\n`);
        chmodSync(path, 0o600);
        return true;
      } catch (err) { trouble(`could not write receipt material ${path}: ${errorText(err)}`); return false; }
    },
    attempted(receiptId) { return { landed: append({ schema: 1, kind: "attempted", at: options.now(), receiptId }) }; },
    returned(receiptId, code) { return append({ schema: 1, kind: "returned", at: options.now(), receiptId, code }); },
    outcome(receiptId, arm) { return append({ schema: 1, kind: "outcome", at: options.now(), receiptId, ...arm, why: arm.why.slice(0, MAX_WHY_CHARS) } as OutcomeReceiptRecord); },
    withdrawn(receiptIds, reason, by) {
      return append({ schema: 1, kind: "withdrawn", at: options.now(), receiptIds: [...receiptIds], reason, actor: by });
    },
    reconcile(receiptId, disposition, by) { return append({ schema: 1, kind: "reconciled", at: options.now(), receiptId, disposition, actor: by }); },
    noteGeneration(pid) {
      if (!Number.isInteger(pid) || pid <= 0 || pid === generation) return;
      append({ schema: 1, kind: "generation", at: options.now(), pid });
    },
    lastGeneration: () => generation,
    get: (receiptId) => states.has(receiptId) ? view(states.get(receiptId)!) : null,
    byRequestId(requestId) { const id = requestIds.get(requestId); return id === undefined ? null : api.get(id); },
    recent(limit) { return [...states.values()].sort((a, b) => b.accepted.at - a.accepted.at || b.receiptId.localeCompare(a.receiptId)).slice(0, Math.max(0, limit)).map(view); },
    forSession(sessionId) { return [...states.values()].filter((state) => state.accepted.target.sessionId === sessionId).map(view); },
    nonTerminal: () => [...states.values()].filter(isNonTerminal).map(view),
    restorable() {
      const result: RestorableItem[] = [];
      for (const state of states.values()) {
        if (!(state.last.kind === "accepted" || state.last.kind === "returned") || state.accepted.queue === null) continue;
        const material = readMaterial(state.receiptId);
        if (material === null) continue;
        result.push({ receiptId: state.receiptId, op: state.accepted.op, origin: state.accepted.origin,
          actor: state.accepted.actor, speaker: state.accepted.speaker, target: state.accepted.target,
          what: state.accepted.what, queue: state.accepted.queue, material, tmuxGeneration: state.accepted.target.tmuxGeneration });
      }
      return result;
    },
    unknownKeystrokeReceipts: () => [...states.values()].filter(isUnknown).map(view),
    durable: () => physicalWritable() && core!.status().failure === null,
    acceptedDurably: (receiptId) => durableAccepted.has(receiptId),
    reservedQueueItemIds: () => [...reservedQueue],
    compact,
    recovery: () => ({ ...recovery, interrupted: [...recovery.interrupted], lostAtRestart: [...recovery.lostAtRestart], recoveryBlocked: [...recovery.recoveryBlocked], orphanEvidence: [...recovery.orphanEvidence], wouldConclude: [...recovery.wouldConclude] }),
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
function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function errorText(err: unknown): string { return err instanceof Error ? err.message : String(err); }
