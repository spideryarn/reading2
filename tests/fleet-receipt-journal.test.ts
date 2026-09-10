import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { takeLock, releaseLock, type HeldLock } from "../tools/overseer/lock.js";
import {
  KEYED_RECEIPT_CAP,
  NON_TERMINAL_CAP,
  RECEIPTS_FILE,
  RETENTION_MS,
  REQUEST_ID_SKEW_MS,
  UNREADABLE_RECEIPTS_FILE,
  admitUnknownRequestId,
  memoryReceiptJournal,
  openReceiptJournal,
  parseReceiptLine,
  parseRequestId,
  reservedQueueItemIds,
  type AcceptReceiptInput,
  type ReceiptActor,
  type ReceiptJournal,
} from "../tools/fleet/receipt-journal.js";

const NOW = 1_800_000_000_000;
const ACTOR: ReceiptActor = { kind: "client-claimed", id: "greg" };
const TARGET = {
  sessionId: "receipt-test-session",
  paneId: "%777",
  claudeSessionId: "8a1d1b11-8479-4ceb-aedf-6eafe8343a65",
  tmuxGeneration: 4401,
};

const dirs: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];

function directory(name: string): string {
  const dir = mkdtempSync(join("/tmp", `spideryarn-receipt-${process.pid}-${name}-`));
  dirs.push(dir);
  return dir;
}

function lockFor(dir: string): HeldLock {
  const path = join(dir, "writer.lock");
  const result = takeLock(path, () => new Date(NOW));
  if (!result.ok) throw new Error("test could not take lock");
  locks.push({ lock: result.lock, path });
  return result.lock;
}

/** The session-scoped arm of the input: every fixture here is about one session. */
type SessionAcceptInput = Extract<AcceptReceiptInput, { target: object }>;

function accepted(overrides: Partial<SessionAcceptInput> = {}): SessionAcceptInput {
  return {
    requestId: null,
    fingerprint: null,
    op: "queued-message",
    origin: "enqueue",
    actor: ACTOR,
    speaker: "greg",
    target: TARGET,
    what: "message (18 characters)",
    queue: { itemId: "receipt-run-q41", enqueuedAt: NOW - 20 },
    ...overrides,
  };
}

function openDisk(dir: string, options: { now?: () => number; writeLine?: (fd: number, line: string) => void } = {}): ReceiptJournal {
  const opened = openReceiptJournal(dir, {
    lock: { held: lockFor(dir), lockedOutBy: null },
    now: options.now ?? (() => NOW),
    serverInstanceId: "receipt-run",
    writeLine: options.writeLine,
  });
  if (opened.kind === "refused") throw new Error(opened.why);
  return opened.journal;
}

function releaseLast(dir: string): void {
  const entry = locks.pop();
  if (entry === undefined) throw new Error("no test lock to release");
  releaseLock(entry.lock, join(dir, "writer.lock"));
}

afterEach(() => {
  for (const entry of locks.splice(0)) {
    try {
      releaseLock(entry.lock, entry.path);
    } catch {
      // A store which owns a lock may already have released it.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("receipt record parsing and transitions", () => {
  it("round-trips every Stage 1a record kind and bounds descriptions", () => {
    const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "receipt-run" });
    const first = journal.accept(accepted({ what: "x".repeat(500) }));
    expect(first).toMatchObject({ ok: true, receiptId: "receipt-run-r1", durable: false });
    if (!first.ok) return;
    expect(journal.attempted(first.receiptId)).toEqual({ landed: true });
    expect(journal.returned(first.receiptId, "send-refused")).toBe(true);
    expect(journal.attempted(first.receiptId)).toEqual({ landed: true });
    expect(journal.outcome(first.receiptId, { state: "keys-submitted", reason: "transport-ok", code: null, why: "sent" })).toBe(true);

    const second = journal.accept(accepted({ queue: { itemId: "receipt-run-q42", enqueuedAt: NOW } }));
    if (!second.ok) return;
    expect(journal.withdrawn([second.receiptId], "cancelled", ACTOR)).toBe(true);

    const third = journal.accept(accepted({ queue: { itemId: "receipt-run-q43", enqueuedAt: NOW } }));
    if (!third.ok) return;
    expect(journal.attempted(third.receiptId).landed).toBe(true);
    expect(journal.outcome(third.receiptId, { state: "outcome-unknown", reason: "partial", code: "send-partial", why: "transport uncertain" })).toBe(true);
    expect(journal.reconcile(third.receiptId, "lease-abandoned", { kind: "system", id: null })).toBe(true);
    journal.noteGeneration(8821);

    expect(journal.recent(20).map((state) => state.last.kind)).toEqual(["reconciled", "withdrawn", "outcome"]);
    expect(journal.lastGeneration()).toBe(8821);
    expect(journal.get(first.receiptId)?.accepted.what.length).toBe(200);
  });

  it("strictly refuses malformed records and counts illegal transitions read from disk", () => {
    const validAccepted = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-old-r1", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message (1 character)", serverInstanceId: "receipt-old",
      queue: { itemId: "receipt-old-q1", enqueuedAt: NOW }, parentReceiptId: null,
    };
    expect(parseReceiptLine(JSON.stringify({ ...validAccepted, extra: true }))).toBeNull();
    expect(parseReceiptLine(JSON.stringify({ ...validAccepted, speaker: "root" }))).toBeNull();
    expect(parseReceiptLine(JSON.stringify(validAccepted))).toEqual(validAccepted);
    // A Stage 1/2 line, written before `parentReceiptId` existed, stays readable and reads as no parent.
    const { parentReceiptId: _none, ...legacy } = validAccepted;
    expect(parseReceiptLine(JSON.stringify(legacy))).toEqual(validAccepted);

    const dir = directory("illegal-read");
    writeFileSync(join(dir, RECEIPTS_FILE), [
      JSON.stringify(validAccepted),
      JSON.stringify({ schema: 1, kind: "attempted", at: NOW, receiptId: "receipt-old-r1" }),
      JSON.stringify({ schema: 1, kind: "outcome", at: NOW + 1, receiptId: "receipt-old-r1", state: "keys-submitted", reason: "transport-ok", code: null, why: "ok" }),
      JSON.stringify({ schema: 1, kind: "returned", at: NOW + 2, receiptId: "receipt-old-r1", code: "late" }),
      "",
    ].join("\n"));
    const journal = openDisk(dir);
    expect(journal.status().illegalTransitions).toBe(1);
    expect(journal.get("receipt-old-r1")?.last.kind).toBe("outcome");
    expect(journal.returned("receipt-old-r1", "late")).toBe(false);
    expect(journal.status().illegalTransitions).toBe(1);
  });

  it("Stage 3: a box-scoped receipt has a null target, a child names its parent, and progress is strict", () => {
    const box = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "stage3-run-r1", requestId: null, fingerprint: null,
      op: "enacted-box", origin: "enacted", actor: { kind: "unattributed-http", id: null }, speaker: null,
      target: null, what: "action kill-test-suites", serverInstanceId: "stage3-run", queue: null, parentReceiptId: null,
    };
    expect(parseReceiptLine(JSON.stringify(box))).toEqual(box);
    // Never a sentinel: a box op with a session target, or a session op without one, is unreadable.
    expect(parseReceiptLine(JSON.stringify({ ...box, target: TARGET }))).toBeNull();
    expect(parseReceiptLine(JSON.stringify({ ...box, op: "enacted-session" }))).toBeNull();
    const child = { ...box, receiptId: "stage3-run-r2", op: "broadcast-recipient", origin: "broadcast", target: TARGET, parentReceiptId: "stage3-run-r1" };
    expect(parseReceiptLine(JSON.stringify(child))).toEqual(child);
    expect(parseReceiptLine(JSON.stringify({ ...child, origin: "direct-steer" }))).toBeNull();
    const progress = { schema: 1, kind: "progress", at: NOW, receiptId: "stage3-run-r1", step: 0, status: "passed", verdict: "it exited 0" };
    expect(parseReceiptLine(JSON.stringify(progress))).toEqual(progress);
    expect(parseReceiptLine(JSON.stringify({ ...progress, step: -1 }))).toBeNull();
    expect(parseReceiptLine(JSON.stringify({ ...progress, verdict: "v".repeat(201) }))).toBeNull();

    const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "stage3-mem" });
    const run = journal.accept({
      requestId: null, fingerprint: null, op: "enacted-session", origin: "enacted",
      actor: ACTOR, speaker: "greg", target: TARGET, what: "action remove-worktree", queue: null,
    });
    if (!run.ok) throw new Error(run.why);
    expect(journal.progress(run.receiptId, 0, "passed", "before attempted")).toBe(false);
    expect(journal.attempted(run.receiptId).landed).toBe(true);
    expect(journal.progress(run.receiptId, 1, "passed", "out of order")).toBe(false);
    expect(journal.progress(run.receiptId, 0, "passed", "it exited 0")).toBe(true);
    expect(journal.progress(run.receiptId, 0, "passed", "twice")).toBe(false);
    expect(journal.get(run.receiptId)?.last.kind).toBe("attempted");
    expect(journal.outcome(run.receiptId, { state: "completed", reason: "fan-out-finished", code: null, why: "a broadcast's arm" })).toBe(false);
    expect(journal.outcome(run.receiptId, { state: "plan-stopped", reason: "gate-refused", code: "step-1", why: "step 1 refused" })).toBe(true);
    expect(journal.progress(run.receiptId, 1, "failed", "after the outcome")).toBe(false);

    const steer = journal.accept({
      requestId: null, fingerprint: null, op: "steer-message", origin: "direct-steer",
      actor: ACTOR, speaker: "greg", target: TARGET, what: "message (3 characters)", queue: null,
    });
    if (!steer.ok) throw new Error(steer.why);
    expect(journal.attempted(steer.receiptId).landed).toBe(true);
    expect(journal.progress(steer.receiptId, 0, "passed", "a steer has no steps")).toBe(false);
    expect(journal.outcome(steer.receiptId, { state: "completed", reason: "plan-passed", code: null, why: "a steer is not a plan" })).toBe(false);
  });

  it("strictly parses every record kind and rejects every outcome state/reason mismatch", () => {
    const acceptedRecord = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "parse-run-r1", requestId: null,
      fingerprint: null, op: "queued-action", origin: "broadcast", actor: { kind: "system", id: null }, speaker: null,
      target: TARGET, what: "catalogue action", serverInstanceId: "parse-run", queue: null, parentReceiptId: null,
    } as const;
    const records = [
      acceptedRecord,
      { schema: 1, kind: "attempted", at: NOW, receiptId: "parse-run-r1" },
      { schema: 1, kind: "returned", at: NOW, receiptId: "parse-run-r1", code: "none" },
      { schema: 1, kind: "outcome", at: NOW, receiptId: "parse-run-r1", state: "keys-submitted", reason: "transport-ok", code: null, why: "ok" },
      { schema: 1, kind: "reconciled", at: NOW, receiptId: "parse-run-r1", disposition: "lease-abandoned", actor: { kind: "system", id: null } },
      { schema: 1, kind: "withdrawn", at: NOW, receiptIds: ["parse-run-r1", "parse-run-r2"], reason: "cleared", actor: ACTOR },
      { schema: 1, kind: "generation", at: NOW, pid: 1234 },
    ];
    for (const record of records) expect(parseReceiptLine(JSON.stringify(record))).toEqual(record);
    for (const [state, reason] of [
      ["keys-submitted", "partial"], ["not-sent", "transport-ok"], ["outcome-unknown", "undeliverable"],
    ]) {
      expect(parseReceiptLine(JSON.stringify({ schema: 1, kind: "outcome", at: NOW, receiptId: "parse-run-r1", state, reason, code: null, why: "bad" }))).toBeNull();
    }
    expect(parseReceiptLine(JSON.stringify({ ...acceptedRecord, what: "w".repeat(201) }))).toBeNull();

    if (process.env["SPIDERYARN_COMPILE_NEGATIVE"] === "1") {
      const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "type-guard" });
      // @ts-expect-error A state/reason pair outside the discriminated union must not compile.
      journal.outcome("type-guard-r1", { state: "keys-submitted", reason: "partial", code: null, why: "impossible" });
    }
  });

  it("refuses illegal write transitions without appending, including a multi-withdrawal atomically", () => {
    const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "transition-run" });
    expect(journal.attempted("missing-r1").landed).toBe(false);
    const first = journal.accept(accepted({ queue: { itemId: "transition-q1", enqueuedAt: NOW } }));
    const second = journal.accept(accepted({ queue: { itemId: "transition-q2", enqueuedAt: NOW } }));
    if (!first.ok || !second.ok) return;
    expect(journal.returned(first.receiptId, "too-soon")).toBe(false);
    expect(journal.reconcile(first.receiptId, "lease-abandoned", ACTOR)).toBe(false);
    expect(journal.attempted(first.receiptId).landed).toBe(true);
    expect(journal.attempted(first.receiptId).landed).toBe(false);
    expect(journal.withdrawn([first.receiptId, second.receiptId], "cleared", ACTOR)).toBe(false);
    expect(journal.get(second.receiptId)?.last.kind).toBe("accepted");
    expect(journal.returned(first.receiptId, "none")).toBe(true);
    expect(journal.outcome(first.receiptId, { state: "outcome-unknown", reason: "partial", code: null, why: "wrong from returned" })).toBe(false);
    expect(journal.withdrawn([first.receiptId, second.receiptId], "cleared", ACTOR)).toBe(true);
    expect(journal.get(first.receiptId)?.last.kind).toBe("withdrawn");
    expect(journal.get(second.receiptId)?.last.kind).toBe("withdrawn");
  });

  it("enforces the complete illegal-next-state matrix at both write and read", () => {
    const trouble: string[] = [];
    const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "matrix-run", onTrouble: (why) => trouble.push(why) });
    const mint = (itemId: string) => journal.accept(accepted({ queue: { itemId, enqueuedAt: NOW } }));
    const acceptedState = mint("matrix-q1");
    if (!acceptedState.ok) return;
    expect(journal.returned(acceptedState.receiptId, "bad")).toBe(false);
    expect(journal.reconcile(acceptedState.receiptId, "lease-abandoned", ACTOR)).toBe(false);
    expect(journal.outcome(acceptedState.receiptId, { state: "keys-submitted", reason: "transport-ok", code: null, why: "bad" })).toBe(false);
    expect(journal.outcome(acceptedState.receiptId, { state: "outcome-unknown", reason: "partial", code: null, why: "bad" })).toBe(false);

    journal.attempted(acceptedState.receiptId);
    expect(journal.attempted(acceptedState.receiptId).landed).toBe(false);
    expect(journal.withdrawn([acceptedState.receiptId], "cancelled", ACTOR)).toBe(false);
    expect(journal.reconcile(acceptedState.receiptId, "lease-abandoned", ACTOR)).toBe(false);
    journal.returned(acceptedState.receiptId, "none");
    expect(journal.returned(acceptedState.receiptId, "again")).toBe(false);
    expect(journal.outcome(acceptedState.receiptId, { state: "keys-submitted", reason: "transport-ok", code: null, why: "bad" })).toBe(false);
    expect(journal.outcome(acceptedState.receiptId, { state: "outcome-unknown", reason: "unknown", code: null, why: "bad" })).toBe(false);

    const terminal = mint("matrix-q2");
    if (!terminal.ok) return;
    journal.attempted(terminal.receiptId);
    journal.outcome(terminal.receiptId, { state: "keys-submitted", reason: "transport-ok", code: null, why: "done" });
    expect(journal.attempted(terminal.receiptId).landed).toBe(false);
    expect(journal.returned(terminal.receiptId, "late")).toBe(false);
    expect(journal.withdrawn([terminal.receiptId], "cancelled", ACTOR)).toBe(false);
    expect(journal.reconcile(terminal.receiptId, "lease-abandoned", ACTOR)).toBe(false);

    const unknown = mint("matrix-q3");
    if (!unknown.ok) return;
    journal.attempted(unknown.receiptId);
    journal.outcome(unknown.receiptId, { state: "outcome-unknown", reason: "partial", code: null, why: "unknown" });
    expect(journal.attempted(unknown.receiptId).landed).toBe(false);
    expect(journal.returned(unknown.receiptId, "late")).toBe(false);
    expect(journal.outcome(unknown.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "rewrite" })).toBe(false);
    expect(journal.withdrawn([unknown.receiptId], "cancelled", ACTOR)).toBe(false);
    expect(journal.reconcile(unknown.receiptId, "lease-abandoned", ACTOR)).toBe(true);
    expect(journal.reconcile(unknown.receiptId, "lease-abandoned", ACTOR)).toBe(false);
    expect(trouble.some((why) => why.includes("illegal receipt transition"))).toBe(true);
    expect(journal.status().illegalTransitions).toBe(0);

    const dir = directory("matrix-read");
    const base = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "read-matrix-r1", requestId: null, fingerprint: null,
      op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET, what: "message",
      serverInstanceId: "read-matrix", queue: null,
    };
    writeFileSync(join(dir, RECEIPTS_FILE), [
      base,
      { schema: 1, kind: "returned", at: NOW, receiptId: "read-matrix-r1", code: "too-soon" },
      { schema: 1, kind: "attempted", at: NOW, receiptId: "read-matrix-r1" },
      { schema: 1, kind: "attempted", at: NOW, receiptId: "read-matrix-r1" },
      { schema: 1, kind: "withdrawn", at: NOW, receiptIds: ["read-matrix-r1"], reason: "cancelled", actor: ACTOR },
      { schema: 1, kind: "outcome", at: NOW, receiptId: "read-matrix-r1", state: "outcome-unknown", reason: "partial", code: null, why: "unknown" },
      { schema: 1, kind: "returned", at: NOW, receiptId: "read-matrix-r1", code: "terminal" },
      { schema: 1, kind: "reconciled", at: NOW, receiptId: "read-matrix-r1", disposition: "lease-abandoned", actor: ACTOR },
      { schema: 1, kind: "attempted", at: NOW, receiptId: "read-matrix-r1" },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");
    const reopened = openDisk(dir);
    expect(reopened.status().illegalTransitions).toBe(5);
    expect(reopened.get("read-matrix-r1")?.last.kind).toBe("reconciled");
  });
});

describe("receipt material", () => {
  it("writes exact material mode 0600 before acceptance and deletes it after every terminal path", () => {
    const dir = directory("material");
    const journal = openDisk(dir);
    const message = journal.putMaterial("receipt-run-r1", { kind: "message", text: "private words", speaker: "greg" });
    expect(message).toBe(true);
    const path = join(dir, "material", "receipt-run-r1.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ kind: "message", text: "private words", speaker: "greg" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const first = journal.accept(accepted());
    expect(first).toMatchObject({ ok: true, receiptId: "receipt-run-r1", durable: true });
    if (!first.ok) return;
    expect(journal.outcome(first.receiptId, { state: "not-sent", reason: "undeliverable", code: "gone", why: "gone" })).toBe(true);
    expect(existsSync(path)).toBe(false);

    expect(journal.putMaterial("receipt-run-r2", { kind: "message", text: "also private", speaker: "overseer" })).toBe(true);
    const second = journal.accept(accepted({ speaker: "overseer", actor: { kind: "client-claimed", id: "overseer" }, queue: { itemId: "receipt-run-q42", enqueuedAt: NOW } }));
    if (!second.ok) return;
    expect(journal.withdrawn([second.receiptId], "cleared", ACTOR)).toBe(true);
    expect(existsSync(join(dir, "material", `${second.receiptId}.json`))).toBe(false);
  });

  it("pins action material through accept and returned, exposes it to restore, then deletes it", () => {
    const dir = directory("action-material");
    const journal = openDisk(dir);
    const action = {
      effect: "spoken", id: "continue", scope: "session", label: "Continue", summary: "Continue safely.",
      text: "Please continue.", form: "prose", needsConfirm: false,
    } as const;
    const result = journal.accept(accepted({ op: "queued-action", material: { kind: "action", action, speaker: "greg" } }));
    if (!result.ok) return;
    expect(journal.restorable()).toMatchObject([{ receiptId: result.receiptId, material: { kind: "action", action } }]);
    journal.attempted(result.receiptId);
    journal.returned(result.receiptId, "nothing-sent");
    expect(journal.restorable()).toHaveLength(1);
    journal.outcome(result.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    expect(existsSync(join(dir, "material", `${result.receiptId}.json`))).toBe(false);
  });

  it("reports failed terminal deletion, retries it at compaction, and removes temp siblings", () => {
    const dir = directory("pending-delete");
    const opened = openReceiptJournal(dir, {
      lock: { held: lockFor(dir), lockedOutBy: null }, now: () => NOW, serverInstanceId: "delete-run",
      deleteMaterial: () => { throw new Error("busy"); },
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const journal = opened.journal;
    const result = journal.accept(accepted({ material: { kind: "message", text: "private", speaker: "greg" } }));
    if (!result.ok) return;
    const final = join(dir, "material", `${result.receiptId}.json`);
    const temp = `${final}.tmp-9000-new-material-test`;
    writeFileSync(temp, "private temp");
    journal.outcome(result.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    expect(journal.status().materialDeletionPending).toEqual([result.receiptId]);
    expect(journal.get(result.receiptId)?.materialDeletionPending).toBe(true);
    journal.close();
    releaseLast(dir);
    const reopened = openDisk(dir);
    expect(reopened.status().materialDeletionPending).toEqual([]);
    expect(existsSync(final)).toBe(false);
    expect(existsSync(temp)).toBe(false);
  });

  it("creates material temp files as 0600 and reports residue when an atomic write fails", () => {
    const dir = directory("private-material-temp");
    const opened = openReceiptJournal(dir, {
      lock: { held: lockFor(dir), lockedOutBy: null }, now: () => NOW, serverInstanceId: "private-run",
      deleteMaterial: () => { throw new Error("busy"); },
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const final = join(dir, "material", "private-run-r1.json");
    mkdirSync(final);
    const previousUmask = process.umask(0);
    try {
      expect(opened.journal.putMaterial("private-run-r1", {
        kind: "message", text: "private temp words", speaker: "greg",
      })).toBe(false);
    } finally {
      process.umask(previousUmask);
    }
    const temps = readdirSync(join(dir, "material")).filter((name) => name.startsWith("private-run-r1.json.tmp-"));
    expect(temps).toHaveLength(1);
    expect(statSync(join(dir, "material", temps[0]!)).mode & 0o777).toBe(0o600);
    expect(opened.journal.status().materialDeletionPending).toEqual(["private-run-r1"]);
    expect(opened.journal.durable()).toBe(false);
    expect(opened.journal.status().failure).toMatch(/material|busy/i);
  });

  it("fails open in memory for unkeyed material-write failure but refuses keyed acceptance", () => {
    const dir = directory("material-fail-open");
    const journal = openDisk(dir);
    mkdirSync(join(dir, "material", "receipt-run-r1.json"));

    const unkeyed = journal.accept(accepted({
      queue: { itemId: "receipt-run-q-material-failure", enqueuedAt: NOW },
      material: { kind: "message", text: "memory survives", speaker: "greg" },
    }));
    expect(unkeyed).toMatchObject({ ok: true, receiptId: "receipt-run-r1", durable: false });
    if (!unkeyed.ok) return;
    expect(journal.restorable()).toMatchObject([{ receiptId: unkeyed.receiptId, material: { text: "memory survives" } }]);
    expect(journal.durable()).toBe(false);
    expect(journal.status().failure).toMatch(/material/i);

    mkdirSync(join(dir, "material", "receipt-run-r2.json"));
    const keyed = journal.accept(accepted({
      requestId: `rq-${NOW.toString(36)}-materialfailkey01`, fingerprint: "fp",
      queue: { itemId: "receipt-run-q-material-keyed", enqueuedAt: NOW },
      material: { kind: "message", text: "must be durable", speaker: "greg" },
    }));
    expect(keyed).toMatchObject({ ok: false });
  });

  it.each([
    { state: "keys-submitted", reason: "transport-ok" } as const,
    { state: "not-sent", reason: "transport-refused-unsent" } as const,
    { state: "outcome-unknown", reason: "unknown" } as const,
  ])("unlinks material for outcome $state", (arm) => {
    const dir = directory(`outcome-${arm.state}`);
    const journal = openDisk(dir);
    const result = journal.accept(accepted({ material: { kind: "message", text: "private", speaker: "greg" } }));
    if (!result.ok) return;
    journal.attempted(result.receiptId);
    expect(journal.outcome(result.receiptId, { ...arm, code: null, why: "finished" })).toBe(true);
    expect(existsSync(join(dir, "material", `${result.receiptId}.json`))).toBe(false);
  });
});

describe("recovery", () => {
  it("concludes dangling attempts as interrupted and missing material as lost", () => {
    const dir = directory("recovery");
    const journal = openDisk(dir);
    journal.putMaterial("receipt-run-r1", { kind: "message", text: "one", speaker: "greg" });
    const attempted = journal.accept(accepted());
    if (!attempted.ok) return;
    journal.attempted(attempted.receiptId);
    const missing = journal.accept(accepted({ queue: { itemId: "receipt-run-q42", enqueuedAt: NOW } }));
    if (!missing.ok) return;
    journal.close();
    releaseLast(dir);

    const reopened = openDisk(dir);
    expect(reopened.get(attempted.receiptId)?.last).toMatchObject({ kind: "outcome", state: "outcome-unknown", reason: "interrupted" });
    expect(reopened.get(missing.receiptId)?.last).toMatchObject({ kind: "outcome", state: "not-sent", reason: "lost-at-restart" });
  });

  it("preserves raw unreadable evidence and applies attributable and blanket blocking", () => {
    const dir = directory("unreadable");
    const a = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-old-r1", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message", serverInstanceId: "receipt-old", queue: { itemId: "receipt-old-q1", enqueuedAt: NOW },
    };
    const b = { ...a, receiptId: "receipt-old-r2", queue: { itemId: "receipt-old-q2", enqueuedAt: NOW } };
    const c = { ...a, receiptId: "receipt-old-r3", queue: { itemId: "receipt-old-q3", enqueuedAt: NOW } };
    const attributable = JSON.stringify({ schema: 1, kind: "attempted", at: "bad", receiptId: "receipt-old-r1" });
    const unattributable = "not json at all";
    writeFileSync(join(dir, RECEIPTS_FILE), [
      JSON.stringify(a), JSON.stringify(b), JSON.stringify(c),
      JSON.stringify({ schema: 1, kind: "attempted", at: NOW, receiptId: "receipt-old-r3" }),
      attributable, unattributable, "",
    ].join("\n"));
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "receipt-old-r1.json"), JSON.stringify({ kind: "message", text: "one", speaker: "greg" }));
    writeFileSync(join(dir, "material", "receipt-old-r2.json"), JSON.stringify({ kind: "message", text: "two", speaker: "greg" }));
    writeFileSync(join(dir, "material", "receipt-old-r3.json"), JSON.stringify({ kind: "message", text: "three", speaker: "greg" }));

    const journal = openDisk(dir);
    expect(journal.get("receipt-old-r1")?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    expect(journal.get("receipt-old-r2")?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    expect(journal.get("receipt-old-r3")?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    expect(journal.recovery()).toMatchObject({ blocked: true });
    const side = readFileSync(join(dir, "receipts.unreadable.jsonl"), "utf8");
    expect(side).toContain(attributable);
    expect(side).toContain(unattributable);
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).not.toContain("not json at all");
  });

  it("proves a direct send at accepted was never attempted, unless malformed bytes could hide its attempt", () => {
    const direct = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-old-r7", requestId: null,
      fingerprint: null, op: "steer-message", origin: "direct-steer", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message (5 characters)", serverInstanceId: "receipt-old", queue: null,
    };
    const clean = directory("direct-clean");
    writeFileSync(join(clean, RECEIPTS_FILE), `${JSON.stringify(direct)}\n`);
    const proven = openDisk(clean);
    expect(proven.get("receipt-old-r7")?.last).toMatchObject({ state: "not-sent", reason: "interrupted-before-attempt" });
    expect(proven.recovery().interruptedBeforeAttempt).toEqual(["receipt-old-r7"]);

    const blocked = directory("direct-blanket");
    writeFileSync(join(blocked, RECEIPTS_FILE), `${JSON.stringify(direct)}\nthese bytes are not json\n`);
    const unproven = openDisk(blocked);
    expect(unproven.get("receipt-old-r7")?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
  });

  it("a locked-out opener reads but writes no bytes and keeps new receipts only in memory", () => {
    const dir = directory("locked-out");
    const writer = openDisk(dir);
    const before = readFileSync(join(dir, RECEIPTS_FILE), "utf8");
    const opened = openReceiptJournal(dir, {
      lock: { held: null, lockedOutBy: "another dashboard owns writer.lock" },
      now: () => NOW,
      serverInstanceId: "loser-run",
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const acceptedResult = opened.journal.accept(accepted({ queue: { itemId: "loser-run-q1", enqueuedAt: NOW } }));
    expect(acceptedResult).toMatchObject({ ok: true, durable: false });
    expect(opened.journal.get("loser-run-r1")).not.toBeNull();
    expect(opened.journal.accept(accepted({
      requestId: `rq-${NOW.toString(36)}-lockedoutkey0001`, fingerprint: "fp",
      queue: { itemId: "loser-run-q2", enqueuedAt: NOW },
    }))).toMatchObject({ ok: false });
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).toBe(before);
    writer.close();
  });

  it("a locked-out opener refuses to claim a durable receipt's attempt landed", () => {
    const dir = directory("locked-durable-attempt");
    const writer = openDisk(dir);
    const result = writer.accept(accepted({
      queue: { itemId: "receipt-run-q-locked-attempt", enqueuedAt: NOW },
      material: { kind: "message", text: "send once", speaker: "greg" },
    }));
    if (!result.ok) return;
    const before = readFileSync(join(dir, RECEIPTS_FILE), "utf8");
    const opened = openReceiptJournal(dir, {
      lock: { held: null, lockedOutBy: "the first dashboard owns writer.lock" },
      now: () => NOW,
      serverInstanceId: "reader-run",
    });
    if (opened.kind === "refused") throw new Error(opened.why);

    expect(opened.journal.acceptedDurably(result.receiptId)).toBe(true);
    expect(opened.journal.attempted(result.receiptId)).toEqual({ landed: false });
    expect(opened.journal.get(result.receiptId)?.last.kind).toBe("accepted");
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).toBe(before);
    writer.close();
  });

  it("a locked-out opener reports recovery conclusions it would make without changing disk", () => {
    const dir = directory("locked-recovery");
    const writer = openDisk(dir);
    const result = writer.accept(accepted({ queue: { itemId: "locked-q1", enqueuedAt: NOW } }));
    if (!result.ok) return;
    const before = readFileSync(join(dir, RECEIPTS_FILE), "utf8");
    const opened = openReceiptJournal(dir, {
      lock: { held: null, lockedOutBy: "the first dashboard owns writer.lock" }, now: () => NOW, serverInstanceId: "reader-run",
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    expect(opened.journal.recovery().wouldConclude).toContainEqual({ receiptId: result.receiptId, state: "not-sent", reason: "lost-at-restart" });
    expect(opened.journal.get(result.receiptId)?.last.kind).toBe("accepted");
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).toBe(before);
  });

  it("does not claim deletion is pending for locked-out material that existed only in memory", () => {
    const dir = directory("locked-memory-material");
    const writer = openDisk(dir);
    const opened = openReceiptJournal(dir, {
      lock: { held: null, lockedOutBy: "the first dashboard owns writer.lock" }, now: () => NOW, serverInstanceId: "reader-run",
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const result = opened.journal.accept(accepted({
      queue: { itemId: "reader-run-q1", enqueuedAt: NOW }, material: { kind: "message", text: "memory private", speaker: "greg" },
    }));
    if (!result.ok) return;
    expect(opened.journal.outcome(result.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" })).toBe(true);
    expect(opened.journal.get(result.receiptId)?.materialDeletionPending).toBe(false);
    expect(opened.journal.status().materialDeletionPending).toEqual([]);
    writer.close();
  });

  it("treats an invalid generation envelope narrowly and an early attributable action as orphan evidence", () => {
    const dir = directory("envelopes");
    const acceptedRecord = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-old-r7", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message", serverInstanceId: "receipt-old", queue: { itemId: "receipt-old-q7", enqueuedAt: NOW },
    };
    writeFileSync(join(dir, RECEIPTS_FILE), [
      JSON.stringify({ schema: 1, kind: "attempted", at: "bad", receiptId: "receipt-old-r7" }),
      JSON.stringify(acceptedRecord),
      JSON.stringify({ schema: 1, kind: "generation", at: NOW, pid: "bad" }),
      "",
    ].join("\n"));
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "receipt-old-r7.json"), JSON.stringify({ kind: "message", text: "safe", speaker: "greg" }));
    const journal = openDisk(dir);
    expect(journal.recovery().generationUnproven).toBe(true);
    expect(journal.recovery().orphanEvidence).toEqual(["receipt-old-r7"]);
    expect(journal.get("receipt-old-r7")?.last.kind).toBe("accepted");
    expect(journal.restorable()).toHaveLength(1);
  });

  it("fails both receipts closed when retained queue item ids collide", () => {
    const dir = directory("id-collision");
    const base = {
      schema: 1, kind: "accepted", at: NOW, requestId: null, fingerprint: null, op: "queued-message",
      origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET, what: "message", serverInstanceId: "old",
      queue: { itemId: "same-q1", enqueuedAt: NOW },
    };
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify({ ...base, receiptId: "old-r1" })}\n${JSON.stringify({ ...base, receiptId: "old-r2" })}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "old-r1.json"), JSON.stringify({ kind: "message", text: "one", speaker: "greg" }));
    writeFileSync(join(dir, "material", "old-r2.json"), JSON.stringify({ kind: "message", text: "two", speaker: "greg" }));
    const journal = openDisk(dir);
    for (const id of ["old-r1", "old-r2"]) expect(journal.get(id)?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
  });

  it("refuses a duplicate request id and fails closed if disk evidence already claims it twice", () => {
    const dir = directory("request-id-collision");
    const requestId = `rq-${NOW.toString(36)}-duplicatekey0001`;
    const first = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "duplicate-old-r1", requestId, fingerprint: "same",
      op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET, what: "message",
      serverInstanceId: "duplicate-old", queue: { itemId: "duplicate-old-q1", enqueuedAt: NOW },
    };
    const second = {
      ...first, receiptId: "duplicate-old-r2", queue: { itemId: "duplicate-old-q2", enqueuedAt: NOW },
    };
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    for (const id of [first.receiptId, second.receiptId]) {
      writeFileSync(join(dir, "material", `${id}.json`), JSON.stringify({ kind: "message", text: id, speaker: "greg" }));
    }

    const journal = openDisk(dir);
    for (const id of [first.receiptId, second.receiptId]) {
      expect(journal.get(id)?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    }
    expect(journal.accept(accepted({
      requestId, fingerprint: "same", queue: { itemId: "duplicate-new-q1", enqueuedAt: NOW },
    }))).toMatchObject({ ok: false });
  });

  it("deletes final and temporary material with no live receipt at startup", () => {
    const dir = directory("orphan-material");
    mkdirSync(join(dir, "material"), { recursive: true });
    const final = join(dir, "material", "orphan-r1.json");
    const temp = `${final}.tmp-3000-orphan-test`;
    writeFileSync(final, JSON.stringify({ kind: "message", text: "private", speaker: "greg" }));
    writeFileSync(temp, "private temp");
    openDisk(dir);
    expect(existsSync(final)).toBe(false);
    expect(existsSync(temp)).toBe(false);
  });

  it("never compacts unreadable main-file evidence when the side-file copy fails", () => {
    const dir = directory("side-copy-failure");
    const acceptedRecord = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "side-run-r1", requestId: null, fingerprint: null,
      op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET, what: "message",
      serverInstanceId: "side-run", queue: { itemId: "side-run-q1", enqueuedAt: NOW },
    };
    const unreadable = JSON.stringify({ schema: 1, kind: "attempted", at: "bad", receiptId: "side-run-r1" });
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(acceptedRecord)}\n${unreadable}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "side-run-r1.json"), JSON.stringify({ kind: "message", text: "private", speaker: "greg" }));
    mkdirSync(join(dir, UNREADABLE_RECEIPTS_FILE)); // open("a") must fail: this is a directory.
    const journal = openDisk(dir);
    expect(journal.status().failure).toContain(UNREADABLE_RECEIPTS_FILE);
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).toContain(unreadable);
    expect(journal.compact()).toBe(false);
    expect(readFileSync(join(dir, RECEIPTS_FILE), "utf8")).toContain(unreadable);
  });

  it("does not restore an unreadable-attempt receipt when its recovery conclusion cannot land", () => {
    const dir = directory("blocked-conclusion-write-failure");
    const acceptedRecord = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "blocked-run-r1", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message", serverInstanceId: "blocked-run",
      queue: { itemId: "blocked-run-q1", enqueuedAt: NOW },
    };
    const unreadableAttempt = JSON.stringify({
      schema: 1, kind: "attempted", at: "bad", receiptId: "blocked-run-r1",
    });
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(acceptedRecord)}\n${unreadableAttempt}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "blocked-run-r1.json"), JSON.stringify({ kind: "message", text: "send once", speaker: "greg" }));

    const journal = openDisk(dir, { writeLine: () => { throw new Error("disk full during recovery"); } });
    expect(journal.status().failure).toContain("disk full during recovery");
    expect(journal.restorable()).toEqual([]);
    expect(journal.recovery().wouldConclude).toContainEqual({
      receiptId: "blocked-run-r1", state: "outcome-unknown", reason: "recovery-blocked",
    });
  });

  it("fails a restorable receipt closed when a valid illegal outcome proves an attempt", () => {
    const dir = directory("illegal-outcome-evidence");
    const acceptedRecord = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "illegal-proof-r1", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg",
      target: TARGET, what: "message", serverInstanceId: "illegal-proof",
      queue: { itemId: "illegal-proof-q1", enqueuedAt: NOW },
    };
    const outcomeWithoutAttempt = {
      schema: 1, kind: "outcome", at: NOW + 1, receiptId: "illegal-proof-r1",
      state: "keys-submitted", reason: "transport-ok", code: null, why: "keys left the process",
    };
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(acceptedRecord)}\n${JSON.stringify(outcomeWithoutAttempt)}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "illegal-proof-r1.json"), JSON.stringify({ kind: "message", text: "do not repeat", speaker: "greg" }));

    const journal = openDisk(dir);
    expect(journal.status().illegalTransitions).toBe(1);
    expect(journal.get("illegal-proof-r1")?.last).toMatchObject({
      kind: "outcome", state: "outcome-unknown", reason: "recovery-blocked",
    });
    expect(journal.restorable()).toEqual([]);
  });
});

describe("retention, capacity, ids and write failures", () => {
  it("keeps keyed receipts through seven days, then expires them", () => {
    let time = NOW;
    const dir = directory("keyed-retention");
    const opened = openReceiptJournal(dir, {
      lock: { held: lockFor(dir), lockedOutBy: null }, now: () => time, serverInstanceId: "receipt-run",
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const journal = opened.journal;
    const requestId = `rq-${NOW.toString(36)}-abcdefghijklmnop`;
    const got = journal.accept(accepted({ requestId, fingerprint: "fp", queue: null }));
    if (!got.ok) return;
    journal.outcome(got.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "gone" });
    time = NOW + RETENTION_MS;
    expect(journal.byRequestId(requestId)).not.toBeNull();
    time += 1;
    journal.compact();
    expect(journal.byRequestId(requestId)).toBeNull();
  });

  it("compacts expired keyed and oldest excess unkeyed terminals on disk but never non-terminals", () => {
    let time = NOW;
    const dir = directory("retention-disk");
    const opened = openReceiptJournal(dir, {
      lock: { held: lockFor(dir), lockedOutBy: null }, now: () => time, serverInstanceId: "retain-run", unkeyedTerminalCap: 2,
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const journal = opened.journal;
    const keyedId = `rq-${NOW.toString(36)}-retentionkey00001`;
    const keyed = journal.accept(accepted({ requestId: keyedId, fingerprint: "fp", queue: null }));
    if (keyed.ok) journal.outcome(keyed.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    for (let i = 0; i < 3; i += 1) {
      time += 1;
      const item = journal.accept(accepted({ queue: null }));
      if (item.ok) journal.outcome(item.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    }
    const live = journal.accept(accepted({ queue: { itemId: "retain-run-q-live", enqueuedAt: time } }));
    time = NOW + RETENTION_MS + 10;
    journal.compact();
    expect(journal.byRequestId(keyedId)).toBeNull();
    expect(journal.nonTerminal().map((state) => state.receiptId)).toEqual(live.ok ? [live.receiptId] : []);
    const terminalUnkeyed = journal.recent(20).filter((state) => state.accepted.requestId === null && state.last.kind === "outcome");
    expect(terminalUnkeyed).toHaveLength(0); // All are past seven-day retention, regardless of count.
  });

  it("drops oldest unkeyed terminal receipts over the count while keeping live receipts", () => {
    let time = NOW;
    const journal = memoryReceiptJournal({ now: () => time, serverInstanceId: "unkeyed-cap", unkeyedTerminalCap: 2 });
    const terminalIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = journal.accept(accepted({ queue: null }));
      if (!result.ok) continue;
      terminalIds.push(result.receiptId);
      journal.outcome(result.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
      time += 1;
    }
    const live = journal.accept(accepted({ queue: { itemId: "unkeyed-cap-q-live", enqueuedAt: time } }));
    journal.compact();
    expect(journal.get(terminalIds[0]!)).toBeNull();
    expect(journal.get(terminalIds[1]!)).not.toBeNull();
    expect(journal.get(terminalIds[2]!)).not.toBeNull();
    expect(live.ok && journal.get(live.receiptId)).not.toBeNull();
  });

  it("enforces the unkeyed terminal cap on append rather than waiting for an unrelated compaction", () => {
    let time = NOW;
    const journal = memoryReceiptJournal({ now: () => time, serverInstanceId: "unkeyed-auto-cap", unkeyedTerminalCap: 2 });
    for (let i = 0; i < 3; i += 1) {
      const result = journal.accept(accepted({ queue: null }));
      if (!result.ok) return;
      expect(journal.outcome(result.receiptId, {
        state: "not-sent", reason: "undeliverable", code: null, why: "done",
      })).toBe(true);
      time += 1;
    }
    expect(journal.recent(10).filter((state) => state.accepted.requestId === null)).toHaveLength(2);
  });

  it("stores one physical withdrawn record for several receipts", () => {
    const dir = directory("withdrawn-record");
    const journal = openDisk(dir);
    const first = journal.accept(accepted({ queue: { itemId: "withdraw-q1", enqueuedAt: NOW } }));
    const second = journal.accept(accepted({ queue: { itemId: "withdraw-q2", enqueuedAt: NOW } }));
    if (!first.ok || !second.ok) return;
    expect(journal.withdrawn([first.receiptId, second.receiptId], "cleared", ACTOR)).toBe(true);
    const lines = readFileSync(join(dir, RECEIPTS_FILE), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind: string; receiptIds?: string[] });
    const withdrawn = lines.filter((record) => record.kind === "withdrawn");
    expect(withdrawn).toEqual([{ schema: 1, kind: "withdrawn", at: NOW, receiptIds: [first.receiptId, second.receiptId], reason: "cleared", actor: ACTOR }]);
  });

  it("enforces keyed and non-terminal admission caps without eviction", () => {
    const dir = directory("keyed-cap");
    const opened = openReceiptJournal(dir, {
      lock: { held: lockFor(dir), lockedOutBy: null }, now: () => NOW,
      serverInstanceId: "key-cap", keyedReceiptCap: 2,
    });
    if (opened.kind === "refused") throw new Error(opened.why);
    const keyed = opened.journal;
    for (let i = 0; i < 2; i += 1) {
      const result = keyed.accept(accepted({ requestId: `rq-${NOW.toString(36)}-abcdefghijklmnop${i}`, fingerprint: `fp${i}`, queue: null }));
      if (result.ok) keyed.outcome(result.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    }
    expect(keyed.accept(accepted({ requestId: `rq-${NOW.toString(36)}-abcdefghijklmnopz`, fingerprint: "fpz" }))).toMatchObject({ ok: false });
    expect(keyed.status().keyedReceipts).toBe(2);
    expect(KEYED_RECEIPT_CAP).toBe(5_000);

    const live = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "live-cap", nonTerminalCap: 2 });
    expect(live.accept(accepted({ queue: { itemId: "live-cap-q1", enqueuedAt: NOW } })).ok).toBe(true);
    expect(live.accept(accepted({ queue: { itemId: "live-cap-q2", enqueuedAt: NOW } })).ok).toBe(true);
    expect(live.accept(accepted({ queue: { itemId: "live-cap-q3", enqueuedAt: NOW } }))).toMatchObject({ ok: false });
    expect(live.nonTerminal()).toHaveLength(2);
    expect(NON_TERMINAL_CAP).toBe(1_000);
  });

  it("reserves retained receipt and queue ids and mints above reused run tokens", () => {
    const journal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: "receipt-run" });
    const one = journal.accept(accepted({ queue: { itemId: "receipt-run-q9", enqueuedAt: NOW } }));
    expect(one).toMatchObject({ receiptId: "receipt-run-r1" });
    expect(reservedQueueItemIds(journal)).toContain("receipt-run-q9");
  });

  it("opens above retained same-run suffixes and preserves their queue reservations", () => {
    const dir = directory("same-run-reservation");
    const old = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-run-r9", requestId: null, fingerprint: null,
      op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET, what: "message",
      serverInstanceId: "receipt-run", queue: { itemId: "receipt-run-q88", enqueuedAt: NOW },
    };
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(old)}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", "receipt-run-r9.json"), JSON.stringify({ kind: "message", text: "old", speaker: "greg" }));
    const journal = openDisk(dir);
    const result = journal.accept(accepted({ queue: { itemId: "receipt-run-q89", enqueuedAt: NOW } }));
    expect(result).toMatchObject({ ok: true, receiptId: "receipt-run-r10" });
    expect(journal.reservedQueueItemIds()).toContain("receipt-run-q88");
  });

  it("does not let an unsafe retained suffix stall receipt id minting", () => {
    const dir = directory("unsafe-suffix");
    const old = {
      schema: 1, kind: "accepted", at: NOW, receiptId: "receipt-run-r9007199254740991", requestId: null,
      fingerprint: null, op: "queued-message", origin: "enqueue", actor: ACTOR, speaker: "greg", target: TARGET,
      what: "message", serverInstanceId: "receipt-run", queue: { itemId: "receipt-run-q-unsafe", enqueuedAt: NOW },
    };
    writeFileSync(join(dir, RECEIPTS_FILE), `${JSON.stringify(old)}\n`);
    mkdirSync(join(dir, "material"), { recursive: true });
    writeFileSync(join(dir, "material", `${old.receiptId}.json`), JSON.stringify({ kind: "message", text: "old", speaker: "greg" }));

    const journal = openDisk(dir);
    expect(journal.accept(accepted({ queue: { itemId: "receipt-run-q-new", enqueuedAt: NOW } }))).toMatchObject({
      ok: true, receiptId: "receipt-run-r1",
    });
  });

  it("automatically compacts an expired terminal receipt on the next append", () => {
    let time = NOW;
    const dir = directory("automatic-expiry");
    const opened = openReceiptJournal(dir, { lock: { held: lockFor(dir), lockedOutBy: null }, now: () => time, serverInstanceId: "auto-run" });
    if (opened.kind === "refused") throw new Error(opened.why);
    const journal = opened.journal;
    const oldRequest = `rq-${NOW.toString(36)}-automaticexpiry1`;
    const old = journal.accept(accepted({ requestId: oldRequest, fingerprint: "old", queue: null }));
    if (old.ok) journal.outcome(old.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "done" });
    const before = journal.status().compactions;
    time += RETENTION_MS + 1;
    expect(journal.accept(accepted({ queue: { itemId: "auto-run-q2", enqueuedAt: time } })).ok).toBe(true);
    expect(journal.byRequestId(oldRequest)).toBeNull();
    expect(journal.status().compactions).toBeGreaterThan(before);
  });

  it("writes a generation only when the observed pid changes", () => {
    const dir = directory("generation-change");
    const journal = openDisk(dir);
    journal.noteGeneration(901);
    journal.noteGeneration(901);
    journal.noteGeneration(902);
    const generations = readFileSync(join(dir, RECEIPTS_FILE), "utf8").trim().split("\n")
      .map((line) => JSON.parse(line) as { kind: string; pid?: number }).filter((record) => record.kind === "generation");
    expect(generations.map((record) => record.pid)).toEqual([901, 902]);
    expect(journal.lastGeneration()).toBe(902);
  });

  it("does not mutate durable memory after an injected failed append", () => {
    const dir = directory("failed-write");
    const journal = openDisk(dir, { writeLine: () => { throw new Error("disk full"); } });
    const result = journal.accept(accepted({ requestId: `rq-${NOW.toString(36)}-abcdefghijklmnop`, fingerprint: "fp" }));
    expect(result).toMatchObject({ ok: false });
    expect(journal.recent(10)).toEqual([]);
    expect(journal.acceptedDurably("receipt-run-r1")).toBe(false);
    expect(journal.status().failure).toContain("disk full");
  });

  it("keeps an unkeyed failed accept and later transitions in memory, but still refuses keyed work", () => {
    const dir = directory("unkeyed-fail-open");
    const journal = openDisk(dir, { writeLine: () => { throw new Error("disk full"); } });

    const unkeyed = journal.accept(accepted({
      queue: { itemId: "receipt-run-q-unkeyed", enqueuedAt: NOW },
      material: { kind: "message", text: "volatile words", speaker: "greg" },
    }));
    expect(unkeyed).toMatchObject({ ok: true, receiptId: "receipt-run-r1", durable: false });
    if (!unkeyed.ok) return;
    expect(journal.get(unkeyed.receiptId)?.last.kind).toBe("accepted");
    expect(journal.attempted(unkeyed.receiptId)).toEqual({ landed: true });
    expect(journal.returned(unkeyed.receiptId, "nothing-sent")).toBe(true);

    const keyed = journal.accept(accepted({
      requestId: `rq-${NOW.toString(36)}-failclosedkey0001`,
      fingerprint: "fp",
      queue: { itemId: "receipt-run-q-keyed", enqueuedAt: NOW },
    }));
    expect(keyed).toMatchObject({ ok: false });
  });

  it("keeps a failed returned settlement in memory after a durable attempt", () => {
    const dir = directory("returned-fail-open");
    let writes = 0;
    const journal = openDisk(dir, {
      writeLine: (fd, line) => {
        writes += 1;
        if (writes > 2) throw new Error("disk full after attempt");
        writeSync(fd, line);
      },
    });
    const result = journal.accept(accepted({
      queue: { itemId: "receipt-run-q-returned", enqueuedAt: NOW },
      material: { kind: "message", text: "try again only in this run", speaker: "greg" },
    }));
    if (!result.ok) return;
    expect(journal.attempted(result.receiptId)).toEqual({ landed: true });
    expect(journal.returned(result.receiptId, "nothing-sent")).toBe(true);
    expect(journal.get(result.receiptId)?.last.kind).toBe("returned");
    expect(journal.restorable()).toHaveLength(1);
  });

  it("makes a later withdrawal durable after a returned settlement failed open", () => {
    const dir = directory("withdraw-after-returned-failure");
    let writes = 0;
    const journal = openDisk(dir, {
      writeLine: (fd, line) => {
        writes += 1;
        if (writes === 3) throw new Error("disk full for returned only");
        writeSync(fd, line);
      },
    });
    const result = journal.accept(accepted({
      queue: { itemId: "receipt-run-q-withdraw-after-return", enqueuedAt: NOW },
      material: { kind: "message", text: "cancel after a proven-unsent return", speaker: "greg" },
    }));
    if (!result.ok) throw new Error("setup acceptance failed");
    expect(journal.attempted(result.receiptId)).toEqual({ landed: true });
    expect(journal.returned(result.receiptId, "nothing-sent")).toBe(true);
    journal.noteGeneration(9_801);
    expect(journal.durable()).toBe(false);
    expect(journal.withdrawn([result.receiptId], "cancelled", ACTOR)).toBe(true);
    expect(journal.durable()).toBe(true);
    journal.close();
    releaseLast(dir);

    const reopened = openDisk(dir);
    expect(reopened.get(result.receiptId)?.last).toMatchObject({ kind: "withdrawn", reason: "cancelled" });
    expect(reopened.restorable()).toEqual([]);
  });

  it("never writes a volatile receipt into a later mixed withdrawal or compaction", () => {
    const dir = directory("mixed-volatile-withdrawal");
    let failWrites = true;
    const journal = openDisk(dir, {
      writeLine: (fd, line) => {
        if (failWrites) throw new Error("temporary disk failure");
        writeSync(fd, line);
      },
    });
    const volatile = journal.accept(accepted({ queue: { itemId: "mixed-q-volatile", enqueuedAt: NOW } }));
    if (!volatile.ok) return;
    failWrites = false;
    const durable = journal.accept(accepted({ queue: { itemId: "mixed-q-durable", enqueuedAt: NOW } }));
    if (!durable.ok) return;

    // A later successful append must not make the journal claim every live
    // receipt is durable: the first accepted line still exists only in memory.
    expect(journal.durable()).toBe(false);

    expect(journal.withdrawn([volatile.receiptId, durable.receiptId], "cleared", ACTOR)).toBe(true);
    expect(journal.compact()).toBe(true);
    const text = readFileSync(join(dir, RECEIPTS_FILE), "utf8");
    expect(text).toContain(durable.receiptId);
    expect(text).not.toContain(volatile.receiptId);
  });

  it("validates request ids and freshness at every boundary", () => {
    const good = `rq-${NOW.toString(36)}-abcdefghijklmnop`;
    expect(parseRequestId(good, NOW)).toEqual({ ok: true, mintedAt: NOW });
    expect(parseRequestId(`rq-${NOW.toString(36)}-abcdefghijklmno`, NOW)).toEqual({ ok: false, reason: "bad-format" });
    expect(parseRequestId(`rq-${NOW.toString(36)}-ABCDEFGHIJKLMNOPQRSTUVWXYZ`, NOW)).toEqual({ ok: false, reason: "bad-format" });
    expect(parseRequestId(`rq-${NOW.toString(36)}-${"a".repeat(16)}`, NOW)).toEqual({ ok: true, mintedAt: NOW });
    expect(parseRequestId(`rq-${NOW.toString(36)}-${"a".repeat(40)}`, NOW)).toEqual({ ok: true, mintedAt: NOW });
    expect(parseRequestId(`rq-${NOW.toString(36)}-${"a".repeat(41)}`, NOW)).toEqual({ ok: false, reason: "bad-format" });
    expect(parseRequestId(`rq-0${NOW.toString(36)}-abcdefghijklmnop`, NOW)).toEqual({ ok: false, reason: "bad-format" });
    expect(parseRequestId("rq-zzzzzzzzzzzzzzzzzzzz-abcdefghijklmnop", NOW)).toEqual({ ok: false, reason: "bad-format" });
    expect(admitUnknownRequestId(NOW - REQUEST_ID_SKEW_MS, NOW)).toBe(true);
    expect(admitUnknownRequestId(NOW + REQUEST_ID_SKEW_MS, NOW)).toBe(true);
    expect(admitUnknownRequestId(NOW - REQUEST_ID_SKEW_MS - 1, NOW)).toBe(false);
    expect(admitUnknownRequestId(NOW + REQUEST_ID_SKEW_MS + 1, NOW)).toBe(false);
  });
});
