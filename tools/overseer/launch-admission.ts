/**
 * **WHO MAY TAKE A SLOT, ASKED OF SOMETHING THAT IS NOT THE LAUNCH JOURNAL.**
 *
 * Plan 260910f § D5. The launch protocol reserves a slot from an admission
 * owner before it starts anything, keyed by the occurrence, and records the
 * grant in its own journal afterwards. Two stores and two writes, on purpose:
 * the moment an owner lives anywhere but inside the launch journal, a grant
 * whose reply is lost is a real failure, and the protocol has to survive it by
 * asking again with the same key. Folding the reservation into the journal
 * would make that test pass by deleting the failure mode (GPT Sol's F8), so the
 * interface is kept and this file is the smallest owner behind it.
 *
 * ## What this owner guarantees
 *
 *  - **`reserve` is idempotent by key.** A key already held gets the same grant
 *    back, the same slot, and no second line. That is what turns a lost reply
 *    into a question with a durable answer.
 *  - **`lookup` answers only `reserved` or `none`** — a `wait` or a `refused`
 *    is not a reservation, and letting a lookup return one invited a caller to
 *    treat it as one (F8). The third arm, `unavailable`, is not an answer about
 *    the key: it is this owner saying its own history is unreadable and it
 *    cannot tell. A `none` in that state would license a release nobody proved.
 *  - **Every grant and release is fsynced before it is reported.** A reply that
 *    outruns the disk is a reservation that did not happen.
 *  - **One writer**, by `lock.ts`, and a journal replayed whole or not at all:
 *    an unreadable or illegal line puts the owner in `history-lost`, where it
 *    refuses to reserve or release until an attributed `resolveHistory` (F2's
 *    rule, applied to this journal too).
 *
 * ## What it is not, named
 *
 * **Not a box-wide admission owner.** It bounds only launches made through the
 * launch protocol, it knows nothing about memory or load, and it has two
 * classes with a capacity of one each ({@link admissionPolicy}). The *Enforced launch admission* stage decides whether
 * the box needs more; if it builds a host-local owner, that owner implements
 * {@link AdmissionOwner} and this file goes.
 *
 * **Synchronous, and that is load-bearing.** The protocol's reserve-to-invoke
 * prefix is one non-yielding function (F9), which is what makes "the journal
 * says `reserved`" mean "nothing was invoked". An asynchronous owner would need
 * an explicit current-attempt guard in the protocol instead.
 */
import { closeSync, chmodSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { truncateToLastLine, writeAll, writeAtomically, type JsonlRepair } from "./jsonl.js";
import { releaseLock, stillOurs, takeLock, type HeldLock, type LockRefusal } from "./lock.js";

/**
 * A journal's records, one per line, **blank ones included** (review F14).
 *
 * The caller has run `truncateToLastLine`, so the text is empty or ends in a
 * newline. The one empty element after that final newline is not a record;
 * every other element — `""` too — goes to replay, whose exact parser refuses
 * it. Filtering blanks out instead let `<valid>\n\n<valid>\n` open as whole.
 * Shared by both journals so the rule cannot drift between them.
 */
export function journalRecords(text: string): string[] {
  const records = text.split("\n");
  if (records.at(-1) === "") records.pop();
  return records;
}

/* ------------------------------------------------------------------ *
 * The interface every owner implements.
 * ------------------------------------------------------------------ */

/**
 * The classes, closed: a third is a compile error wherever {@link admissionPolicy}
 * is switched on. `claude-session` is a scheduled or headless run, bounded by its
 * timeout; `recovery-resume` is Greg bringing an interrupted session back.
 */
export type AdmissionClass = "claude-session" | "recovery-resume";

const ADMISSION_CLASSES: readonly AdmissionClass[] = ["claude-session", "recovery-resume"];

/**
 * What must be seen before a class's reservation may be released on evidence
 * (plan (Q2)). `exit-evidence`: a correlation-bound `exit.json` or a reboot —
 * a terminal record. `observed-running`: the child seen running is enough,
 * because what the class paces is the launch itself; one resumed interactive
 * session holding a slot until it exits would block every other resume for
 * hours. `outcome-unknown` ends no hold, in any class.
 */
export type HoldCondition = "exit-evidence" | "observed-running";

export type AdmissionPolicy = { readonly capacity: number; readonly holdUntil: HoldCondition };

/** Each class's policy. EXHAUSTIVE, so a new class says what it holds until. */
export function admissionPolicy(cls: AdmissionClass): AdmissionPolicy {
  switch (cls) {
    case "claude-session":
      return { capacity: 1, holdUntil: "exit-evidence" };
    case "recovery-resume":
      return { capacity: 1, holdUntil: "observed-running" };
    default: {
      const never: never = cls;
      throw new Error(`no admission policy for ${JSON.stringify(never)}`);
    }
  }
}

export function isAdmissionClass(u: unknown): u is AdmissionClass {
  return typeof u === "string" && (ADMISSION_CLASSES as readonly string[]).includes(u);
}

/** A reservation's address. The protocol uses the occurrence id; the owner treats it as opaque but well-formed. */
export type ReservationKey = string & { readonly __brand: "admission-reservation-key" };

/** Lower-case, digits and hyphens: safe in a file, a log line and a shell word without quoting. */
const RESERVATION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function asReservationKey(u: unknown): ReservationKey | null {
  return typeof u === "string" && RESERVATION_KEY_PATTERN.test(u) ? (u as ReservationKey) : null;
}

export type ReservedGrant = { readonly kind: "reserved"; readonly slot: string; readonly ownerId: string };

export type Grant = ReservedGrant | { readonly kind: "wait"; readonly why: string } | { readonly kind: "refused"; readonly why: string };

/** A reservation or its absence — never a `wait` (F8). `unavailable` is the owner unable to answer at all. */
export type Lookup = ReservedGrant | { readonly kind: "none" } | { readonly kind: "unavailable"; readonly why: string };

export type ReleaseAnswer = { readonly kind: "released" } | { readonly kind: "was-not-held" } | { readonly kind: "unavailable"; readonly why: string };

/**
 * What licensed a release. **A release is never optimism** — the roadmap's
 * *release only on evidence or an attributed operator decision* — so the owner
 * is told which, and writes it down beside the release.
 */
export type ReleaseEvidence =
  | { readonly kind: "terminal"; readonly state: "completed" | "failed-before-launch" }
  | { readonly kind: "disposed"; readonly requestId: string }
  /** The child was seen running, and its class is held only until then ({@link HoldCondition}). */
  | { readonly kind: "observed-running" };

export type HeldReservation = { readonly key: ReservationKey; readonly cls: AdmissionClass; readonly slot: string };

export type Inventory = { readonly kind: "read"; readonly reservations: readonly HeldReservation[] } | { readonly kind: "unavailable"; readonly why: string };

export type AdmissionOwner = {
  readonly ownerId: string;
  reserve(key: ReservationKey, cls: AdmissionClass): Grant;
  lookup(key: ReservationKey): Lookup;
  release(key: ReservationKey, because: ReleaseEvidence): ReleaseAnswer;
  /** Every held reservation. F2's history resolution lists them; nothing else needs the whole table. */
  inventory(): Inventory;
};

/**
 * Greg's attributed acceptance that a lost history may conceal something.
 *
 * `acceptHiddenLaunchRisk: true` as a literal type rather than a boolean: a
 * caller cannot build one of these by forgetting a flag, only by writing it.
 * Shared with the launch journal's resolution, which has the same shape.
 */
export type HistoryResolutionRequest = {
  readonly actor: string;
  readonly requestId: string;
  readonly why: string;
  readonly acceptHiddenLaunchRisk: true;
};

/** A request with an empty actor, id or reason is not attributed, whatever its type says. */
export function checkResolutionRequest(request: HistoryResolutionRequest): string | null {
  if (request.acceptHiddenLaunchRisk !== true) return "the request does not accept the hidden-launch risk";
  if (request.actor.trim() === "") return "the request names no actor";
  if (request.why.trim() === "") return "the request gives no reason";
  if (asReservationKey(request.requestId) === null) return `request id ${JSON.stringify(request.requestId)} is not a lower-case word`;
  return null;
}

/* ------------------------------------------------------------------ *
 * The journal's lines, and the fold that decides what is held.
 * ------------------------------------------------------------------ */

export const ADMISSION_DIR = "admission";
export const ADMISSION_JOURNAL = "admission.jsonl";
export const ADMISSION_LOCK = "writer.lock";
const SCHEMA = 1;

type ReservedLine = { readonly v: 1; readonly kind: "reserved"; readonly at: string; readonly key: ReservationKey; readonly cls: AdmissionClass; readonly slot: string };
type ReleasedLine = { readonly v: 1; readonly kind: "released"; readonly at: string; readonly key: ReservationKey; readonly because: ReleaseEvidence };
type ResetLine = {
  readonly v: 1;
  readonly kind: "history-reset";
  readonly at: string;
  readonly actor: string;
  readonly requestId: string;
  readonly why: string;
  readonly preservedAs: string;
  readonly lostAt: { readonly line: number; readonly why: string };
  readonly carried: readonly HeldReservation[];
};
type AdmissionLine = ReservedLine | ReleasedLine | ResetLine;

type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

function isIsoTimestamp(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const parsed = new Date(u);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === u;
}

function isText(u: unknown): u is string {
  return typeof u === "string" && u.trim() !== "";
}

/** EXACT, not permissive: a field this version does not know is a line it does not understand (F11). */
function unexpectedField(u: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const key of Object.keys(u)) if (!fields.includes(key)) return `unexpected field ${JSON.stringify(key)}`;
  return null;
}

function parseEvidence(u: unknown): Parsed<ReleaseEvidence> {
  if (!isRecord(u)) return { ok: false, why: "because is not an object" };
  if (u["kind"] === "terminal") {
    const extra = unexpectedField(u, ["kind", "state"]);
    if (extra !== null) return { ok: false, why: `because: ${extra}` };
    const state = u["state"];
    if (state !== "completed" && state !== "failed-before-launch") return { ok: false, why: "because.state is not a terminal state" };
    return { ok: true, value: { kind: "terminal", state } };
  }
  if (u["kind"] === "disposed") {
    const extra = unexpectedField(u, ["kind", "requestId"]);
    if (extra !== null) return { ok: false, why: `because: ${extra}` };
    const requestId = u["requestId"];
    if (!isText(requestId)) return { ok: false, why: "because.requestId is not a request id" };
    return { ok: true, value: { kind: "disposed", requestId } };
  }
  if (u["kind"] === "observed-running") {
    const extra = unexpectedField(u, ["kind"]);
    if (extra !== null) return { ok: false, why: `because: ${extra}` };
    return { ok: true, value: { kind: "observed-running" } };
  }
  return { ok: false, why: `because.kind ${JSON.stringify(u["kind"])} is not one this version knows` };
}

function parseHeld(u: unknown): Parsed<HeldReservation> {
  if (!isRecord(u)) return { ok: false, why: "a carried reservation is not an object" };
  const extra = unexpectedField(u, ["key", "cls", "slot"]);
  if (extra !== null) return { ok: false, why: extra };
  const key = asReservationKey(u["key"]);
  const cls = u["cls"];
  const slot = u["slot"];
  if (key === null) return { ok: false, why: "carried key is not a reservation key" };
  if (!isAdmissionClass(cls)) return { ok: false, why: "carried cls is not an admission class" };
  if (!isText(slot)) return { ok: false, why: "carried slot is not a slot" };
  return { ok: true, value: { key, cls, slot } };
}

function parseLine(text: string): Parsed<AdmissionLine> {
  let u: unknown;
  try {
    u = JSON.parse(text);
  } catch (cause) {
    return { ok: false, why: `not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!isRecord(u)) return { ok: false, why: "not an object" };
  if (u["v"] !== SCHEMA) return { ok: false, why: `schema ${JSON.stringify(u["v"])} is not one this version reads` };
  const at = u["at"];
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  switch (u["kind"]) {
    case "reserved": {
      const extra = unexpectedField(u, ["v", "kind", "at", "key", "cls", "slot"]);
      if (extra !== null) return { ok: false, why: extra };
      const held = parseHeld({ key: u["key"], cls: u["cls"], slot: u["slot"] });
      if (!held.ok) return held;
      return { ok: true, value: { v: 1, kind: "reserved", at, ...held.value } };
    }
    case "released": {
      const extra = unexpectedField(u, ["v", "kind", "at", "key", "because"]);
      if (extra !== null) return { ok: false, why: extra };
      const key = asReservationKey(u["key"]);
      if (key === null) return { ok: false, why: "key is not a reservation key" };
      const because = parseEvidence(u["because"]);
      if (!because.ok) return because;
      return { ok: true, value: { v: 1, kind: "released", at, key, because: because.value } };
    }
    case "history-reset": {
      const extra = unexpectedField(u, ["v", "kind", "at", "actor", "requestId", "why", "preservedAs", "lostAt", "carried"]);
      if (extra !== null) return { ok: false, why: extra };
      const { actor, requestId, why, preservedAs, lostAt, carried } = u;
      if (!isText(actor) || !isText(requestId) || !isText(why) || !isText(preservedAs)) {
        return { ok: false, why: "a history reset must name its actor, request, reason and preserved file" };
      }
      if (!isRecord(lostAt) || typeof lostAt["line"] !== "number" || !Number.isInteger(lostAt["line"]) || !isText(lostAt["why"])) {
        return { ok: false, why: "lostAt is not a line and a reason" };
      }
      if (!Array.isArray(carried)) return { ok: false, why: "carried is not a list" };
      const list: HeldReservation[] = [];
      for (const one of carried) {
        const held = parseHeld(one);
        if (!held.ok) return held;
        list.push(held.value);
      }
      return {
        ok: true,
        value: { v: 1, kind: "history-reset", at, actor, requestId, why, preservedAs, lostAt: { line: lostAt["line"], why: lostAt["why"] }, carried: list },
      };
    }
    default:
      return { ok: false, why: `kind ${JSON.stringify(u["kind"])} is not one this version knows` };
  }
}

type Table = { held: Map<ReservationKey, HeldReservation>; lines: number };

/**
 * One line against the table: `null` when it is legal, and why when it is not.
 * **Legal, not merely well-formed** (F11): a release of a key nobody holds, or a
 * second reservation of a held key or an occupied slot, is a history that did
 * not happen, and folding past it would make a plausible table out of it.
 */
function illegality(table: Table, line: AdmissionLine): string | null {
  switch (line.kind) {
    case "reserved": {
      if (table.held.has(line.key)) return `${line.key} was reserved twice`;
      for (const other of table.held.values()) {
        if (other.slot === line.slot) return `slot ${line.slot} was given to ${line.key} while ${other.key} held it`;
      }
      return null;
    }
    case "released":
      return table.held.has(line.key) ? null : `${line.key} was released without being held`;
    case "history-reset":
      return table.lines === 0 ? null : "a history reset appears after the first line";
    default: {
      const never: never = line;
      return `no rule for ${JSON.stringify(never)}`;
    }
  }
}

function apply(table: Table, line: AdmissionLine): void {
  switch (line.kind) {
    case "reserved":
      table.held.set(line.key, { key: line.key, cls: line.cls, slot: line.slot });
      break;
    case "released":
      table.held.delete(line.key);
      break;
    case "history-reset":
      for (const one of line.carried) table.held.set(one.key, one);
      break;
    default: {
      const never: never = line;
      throw new Error(`no fold for ${JSON.stringify(never)}`);
    }
  }
  table.lines += 1;
}

/* ------------------------------------------------------------------ *
 * The local owner.
 * ------------------------------------------------------------------ */

export type AdmissionStatus =
  | { readonly kind: "whole"; readonly lines: number }
  | { readonly kind: "history-lost"; readonly atLine: number; readonly why: string };

export type AdmissionRefusal = LockRefusal | { reason: "relative-root"; path: string } | { reason: "unusable-journal"; path: string; detail: string };

export type LocalAdmission = AdmissionOwner & {
  readonly repair: JsonlRepair;
  status(): AdmissionStatus;
  /** F2 for this journal: preserve it byte-for-byte, carry what it can still see as held, start again. Only from `history-lost`. */
  resolveHistory(request: HistoryResolutionRequest): { ok: true; preservedAs: string; carried: readonly HeldReservation[] } | { ok: false; why: string };
  close(): void;
};

export type LocalAdmissionOptions = {
  /** The store root — `~/.overseer` or `OVERSEER_STORE_DIR`. Absolute, for the reason store.ts gives. */
  readonly root: string;
  readonly now: () => Date;
  /** Slots per class, overriding every class's {@link admissionPolicy} capacity. Only a test passes it. */
  readonly capacity?: number;
  readonly ownerId?: string;
};

export const LOCAL_OWNER_ID = "local-admission";

export function openLocalAdmission(options: LocalAdmissionOptions): { ok: true; owner: LocalAdmission } | { ok: false; refusal: AdmissionRefusal } {
  if (!isAbsolute(options.root)) return { ok: false, refusal: { reason: "relative-root", path: options.root } };
  const dir = join(options.root, ADMISSION_DIR);
  const journalPath = join(dir, ADMISSION_JOURNAL);
  const lockPath = join(dir, ADMISSION_LOCK);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  } catch (cause) {
    return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
  }
  const taken = takeLock(lockPath, options.now);
  if (!taken.ok) return { ok: false, refusal: taken.refusal };
  const lock: HeldLock = taken.lock;

  let repair: JsonlRepair;
  let texts: string[];
  let fd: number;
  try {
    repair = truncateToLastLine(journalPath);
    texts = existsSync(journalPath) ? journalRecords(readFileSync(journalPath, "utf8")) : [];
    fd = openSync(journalPath, "a", 0o600);
  } catch (cause) {
    releaseLock(lock, lockPath);
    return { ok: false, refusal: { reason: "unusable-journal", path: journalPath, detail: String(cause) } };
  }

  const capacityOf = (cls: AdmissionClass): number => options.capacity ?? admissionPolicy(cls).capacity;
  const ownerId = options.ownerId ?? LOCAL_OWNER_ID;
  let table: Table = { held: new Map(), lines: 0 };
  let status: AdmissionStatus = { kind: "whole", lines: 0 };
  // THE SALVAGE: every line that parses, legal or not, folded loosely. It is
  // what a history resolution carries forward as held — over-counting a held
  // slot costs a `dispose`, under-counting it costs a second session.
  const salvage = new Map<ReservationKey, HeldReservation>();

  const replay = (lines: readonly string[]): void => {
    table = { held: new Map(), lines: 0 };
    status = { kind: "whole", lines: 0 };
    salvage.clear();
    lines.forEach((text, index) => {
      const parsed = parseLine(text);
      if (parsed.ok) {
        if (parsed.value.kind === "reserved") salvage.set(parsed.value.key, { key: parsed.value.key, cls: parsed.value.cls, slot: parsed.value.slot });
        else if (parsed.value.kind === "released") salvage.delete(parsed.value.key);
        else for (const one of parsed.value.carried) salvage.set(one.key, one);
      }
      if (status.kind === "history-lost") return;
      const why = parsed.ok ? illegality(table, parsed.value) : parsed.why;
      if (why !== null) {
        status = { kind: "history-lost", atLine: index + 1, why };
        return;
      }
      if (parsed.ok) apply(table, parsed.value);
      status = { kind: "whole", lines: table.lines };
    });
  };
  replay(texts);

  const appendLine = (line: AdmissionLine): { ok: true } | { ok: false; why: string } => {
    if (status.kind === "history-lost") return { ok: false, why: `the admission journal lost its history at line ${status.atLine}: ${status.why}` };
    if (!stillOurs(lock, lockPath)) return { ok: false, why: `${lockPath} is no longer held by this owner` };
    const illegal = illegality(table, line);
    if (illegal !== null) return { ok: false, why: illegal };
    try {
      writeAll(fd, `${JSON.stringify(line)}\n`);
      fsyncSync(fd);
    } catch (cause) {
      return { ok: false, why: `the append failed: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    apply(table, line);
    status = { kind: "whole", lines: table.lines };
    return { ok: true };
  };

  const lost = (): string | null => (status.kind === "history-lost" ? `the admission journal lost its history at line ${status.atLine} (${status.why}), so it cannot answer until Greg resolves it` : null);

  const owner: LocalAdmission = {
    ownerId,
    repair,
    status: () => status,
    reserve(key, cls) {
      const refusedBecause = lost();
      if (refusedBecause !== null) return { kind: "refused", why: refusedBecause };
      if (asReservationKey(key) === null) return { kind: "refused", why: `${JSON.stringify(key)} is not a reservation key` };
      const existing = table.held.get(key);
      if (existing !== undefined) return { kind: "reserved", slot: existing.slot, ownerId };
      const occupied = new Set([...table.held.values()].filter((one) => one.cls === cls).map((one) => one.slot));
      let slot: string | null = null;
      for (let n = 1; n <= capacityOf(cls); n += 1) {
        const candidate = `${cls}#${n}`;
        if (!occupied.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (slot === null) {
        const holders = [...table.held.values()].filter((one) => one.cls === cls).map((one) => one.key);
        return { kind: "wait", why: `every ${cls} slot is held (${holders.join(", ")})` };
      }
      // A GRANT THAT DID NOT REACH THE DISK IS A WAIT, not a refusal: nothing
      // was reserved, and a refusal would read as a policy decision.
      const wrote = appendLine({ v: 1, kind: "reserved", at: options.now().toISOString(), key, cls, slot });
      if (!wrote.ok) return { kind: "wait", why: `the reservation could not be recorded: ${wrote.why}` };
      return { kind: "reserved", slot, ownerId };
    },
    lookup(key) {
      const unavailable = lost();
      if (unavailable !== null) return { kind: "unavailable", why: unavailable };
      const held = table.held.get(key);
      return held === undefined ? { kind: "none" } : { kind: "reserved", slot: held.slot, ownerId };
    },
    release(key, because) {
      const unavailable = lost();
      if (unavailable !== null) return { kind: "unavailable", why: unavailable };
      if (!table.held.has(key)) return { kind: "was-not-held" };
      const wrote = appendLine({ v: 1, kind: "released", at: options.now().toISOString(), key, because });
      return wrote.ok ? { kind: "released" } : { kind: "unavailable", why: wrote.why };
    },
    inventory() {
      const unavailable = lost();
      if (unavailable !== null) return { kind: "unavailable", why: unavailable };
      return { kind: "read", reservations: [...table.held.values()] };
    },
    resolveHistory(request) {
      if (status.kind !== "history-lost") return { ok: false, why: "the admission journal's history is whole; there is nothing to resolve" };
      const bad = checkResolutionRequest(request);
      if (bad !== null) return { ok: false, why: bad };
      const at = options.now().toISOString();
      const preservedAs = `${ADMISSION_JOURNAL}.lost-${at.replace(/[^0-9]/g, "")}-${request.requestId}`;
      const carried = [...salvage.values()];
      const reset: ResetLine = {
        v: 1,
        kind: "history-reset",
        at,
        actor: request.actor,
        requestId: request.requestId,
        why: request.why,
        preservedAs,
        lostAt: { line: status.atLine, why: status.why },
        carried,
      };
      const preserved = preserveThenReplace(dir, journalPath, preservedAs, `${JSON.stringify(reset)}\n`);
      if (!preserved.ok) return preserved;
      try {
        closeSync(fd);
        fd = openSync(journalPath, "a", 0o600);
      } catch (cause) {
        return { ok: false, why: `the fresh journal was written and could not be reopened: ${String(cause)}` };
      }
      replay([JSON.stringify(reset)]);
      return { ok: true, preservedAs, carried };
    },
    close() {
      try {
        closeSync(fd);
      } finally {
        releaseLock(lock, lockPath);
      }
    },
  };
  return { ok: true, owner };
}

/**
 * **KEEP THE OLD BYTES, THEN REPLACE THE JOURNAL IN ONE STEP.**
 *
 * A hard link first, so the preserved file is the same inode and cannot differ
 * by a byte; then the fresh journal renamed over the old name. The order is the
 * point: the other order — rename the old one away, then write the new one —
 * has a moment with no journal at all, and a start inside that moment reads an
 * empty history, which is exactly the licence to launch everything again that
 * `history-lost` exists to refuse. Exported for the launch store, which resets
 * its own journal the same way.
 */
export function preserveThenReplace(dir: string, journalPath: string, preservedAs: string, fresh: string): { ok: true } | { ok: false; why: string } {
  const preservedPath = join(dir, preservedAs);
  try {
    if (existsSync(preservedPath)) {
      // A RETRY OF THE SAME REQUEST after a crash between the link and the
      // replace: the link is already there, and it is fine only if it is still
      // the journal's own bytes.
      if (!readFileSync(preservedPath).equals(readFileSync(journalPath))) {
        return { ok: false, why: `${preservedAs} already exists and is not this journal` };
      }
    } else {
      linkSync(journalPath, preservedPath);
    }
    writeAtomically(journalPath, dir, fresh);
  } catch (cause) {
    return { ok: false, why: `the old journal could not be preserved and replaced: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  return { ok: true };
}
