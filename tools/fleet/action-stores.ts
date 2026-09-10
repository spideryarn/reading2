/**
 * The process-wide composition for the fleet dashboard's durable action stores.
 *
 * Holds and receipts share one `writer.lock` claim. Keeping the ownership,
 * singleton installation, fallback, and reset here as one unit prevents two
 * dashboards from each winning half of the durable account.
 *
 * docs/plans/260910d § The stores, and who owns them.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describeLockRefusal, releaseLock, takeLock, type HeldLock } from "../overseer/lock.js";
import type { SharedJournalLock } from "./journal-file.js";
import { holdLedgerDir, LOCK_FILE, openHoldLedger, type HoldLedger } from "./hold-ledger.js";
import { serverInstanceId } from "./instance.js";
import {
  installSharedQuarantineLedger,
  resetSharedQuarantineStateForActionStores,
  sharedQuarantineWasOpened,
  type QuarantineBook,
} from "./quarantine.js";
import {
  memoryReceiptJournal,
  openReceiptJournal,
  type ReceiptJournal,
  type ReceiptOp,
  type RecoverySummary,
} from "./receipt-journal.js";

let sharedReceipts: ReceiptJournal | null = null;
let receiptsWereHandedOut = false;
let openedStores: FleetActionStores | null = null;
let startupUnknownWithoutHold: UnknownWithoutHold[] | null = null;
let ownedStoreLock: HeldLock | null = null;
let ownedStoreLockPath: string | null = null;

export type UnknownWithoutHold = { sessionId: string; receiptIds: string[] };

export type FleetActionStores = {
  book: QuarantineBook;
  /** The ledger, or null when it would not open — durability off, everything else unchanged. */
  ledger: HoldLedger | null;
  receipts: ReceiptJournal;
  rehydrated: { holds: number; attempts: number; skipped: number };
  recovery: ReturnType<ReceiptJournal["recovery"]>;
  /** Recovery uncertainty which had no hold when this process started. */
  unknownWithoutHold: UnknownWithoutHold[];
  /** Startup facts in sentences the launcher can print. */
  lines: { log: string[]; error: string[] };
};

export type OpenFleetActionStoresOptions = {
  dir?: string | undefined;
  log?: ((line: string) => void) | undefined;
  /** Test seams; production uses the process clock and run id. */
  now?: (() => number) | undefined;
  serverInstanceId?: string | undefined;
};

/**
 * The receipt journal used by queue and routes.
 *
 * Lazy for `sharedQuarantineBook()`'s reason: imports must not touch the real
 * filesystem. Before startup it is deliberately memory-only, and its status
 * says "never opened" rather than silently looking durable. Asking for it is
 * remembered, because a later durable open would have missed actions already
 * accepted through the object somebody was handed.
 */
export function sharedReceiptJournal(): ReceiptJournal {
  if (sharedReceipts === null) {
    sharedReceipts = memoryReceiptJournal({
      now: () => Date.now(),
      serverInstanceId: serverInstanceId(),
    });
    receiptsWereHandedOut = true;
  }
  return sharedReceipts;
}

function cloneUnknownWithoutHold(rows: UnknownWithoutHold[]): UnknownWithoutHold[] {
  return rows.map((row) => ({ sessionId: row.sessionId, receiptIds: [...row.receiptIds] }));
}

/**
 * The startup snapshot used by the receipt route, or null before startup.
 *
 * This deliberately never follows live receipt or hold changes. During a run,
 * an uncertain send opens a hold; the exceptional mismatch this reports is a
 * fact about recovery, computed only after both stores have rebuilt themselves.
 */
export function sharedUnknownWithoutHold(): UnknownWithoutHold[] | null {
  return startupUnknownWithoutHold === null ? null : cloneUnknownWithoutHold(startupUnknownWithoutHold);
}

function isKeystrokeOp(op: ReceiptOp): boolean {
  switch (op) {
    case "queued-message":
    case "queued-action":
    case "steer-message":
    case "steer-answer":
    case "broadcast-recipient":
      return true;
    // A plan's steps are not keystrokes, and a broadcast parent types nothing itself.
    case "enacted-session":
    case "enacted-box":
    case "broadcast":
      return false;
    default: {
      const never: never = op;
      return never;
    }
  }
}

function computeUnknownWithoutHold(
  receipts: ReceiptJournal,
  recovery: RecoverySummary,
  book: QuarantineBook,
): UnknownWithoutHold[] {
  const landedRecoveryIds = new Set([...recovery.interrupted, ...recovery.recoveryBlocked]);
  const receiptIds = new Set(
    receipts
      .unknownKeystrokeReceipts()
      .map((state) => state.receiptId)
      .filter((receiptId) => landedRecoveryIds.has(receiptId)),
  );
  for (const conclusion of recovery.wouldConclude) {
    if (
      conclusion.state === "outcome-unknown" &&
      (conclusion.reason === "interrupted" || conclusion.reason === "recovery-blocked")
    ) {
      receiptIds.add(conclusion.receiptId);
    }
  }

  const bySession = new Map<string, string[]>();
  for (const receiptId of receiptIds) {
    const state = receipts.get(receiptId);
    if (state === null || state.accepted.target === null || !isKeystrokeOp(state.accepted.op)) continue;
    const sessionId = state.accepted.target.sessionId;
    if (book.holding(sessionId) !== null) continue;
    const ids = bySession.get(sessionId) ?? [];
    ids.push(receiptId);
    bySession.set(sessionId, ids);
  }
  return [...bySession]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sessionId, ids]) => ({ sessionId, receiptIds: ids.sort((a, b) => a.localeCompare(b)) }));
}

function installUnknownWithoutHold(
  receipts: ReceiptJournal,
  recovery: RecoverySummary,
  book: QuarantineBook,
): UnknownWithoutHold[] {
  startupUnknownWithoutHold = computeUnknownWithoutHold(receipts, recovery, book);
  return cloneUnknownWithoutHold(startupUnknownWithoutHold);
}

function memoryActionStores(now: () => number, runId: string, errors: string[]): FleetActionStores {
  const receipts = memoryReceiptJournal({ now, serverInstanceId: runId });
  sharedReceipts = receipts;
  const { book, rehydrated } = installSharedQuarantineLedger(null, { now, serverInstanceId: runId });
  const recovery = receipts.recovery();
  const startup: FleetActionStores = {
    book,
    ledger: null,
    receipts,
    rehydrated,
    recovery,
    unknownWithoutHold: installUnknownWithoutHold(receipts, recovery, book),
    lines: { log: [], error: errors },
  };
  openedStores = startup;
  return startup;
}

function accountForReceiptJournal(
  status: ReturnType<ReceiptJournal["status"]>,
  lines: { log: string[]; error: string[] },
): void {
  lines.log.push(`receipt journal → ${status.dir}`);
  if (status.repaired.torn) {
    lines.error.push(`receipt journal: repaired a torn last line (${status.repaired.droppedBytes} bytes dropped)`);
  }
  if (status.unreadableLines > 0) {
    lines.error.push(`receipt journal: ${status.unreadableLines} line(s) could not be read`);
  }
  if (status.lockedOutBy !== null) lines.error.push(`receipt journal is read-only here: ${status.lockedOutBy}`);
  if (status.failure !== null) lines.error.push(`receipt journal: ${status.failure}`);
}

function accountForHoldLedger(
  status: ReturnType<HoldLedger["status"]>,
  rehydrated: FleetActionStores["rehydrated"],
  lines: { log: string[]; error: string[] },
): void {
  lines.log.push(`hold ledger → ${status.dir}`);
  if (status.repaired.torn) {
    lines.error.push(`hold ledger: repaired a torn last line (${status.repaired.droppedBytes} bytes dropped)`);
  }
  if (status.unreadableLines > 0) lines.error.push(`hold ledger: ${status.unreadableLines} line(s) could not be read`);
  if (status.lockedOutBy !== null) lines.error.push(`hold ledger is read-only here: ${status.lockedOutBy}`);
  if (rehydrated.holds + rehydrated.attempts > 0) {
    lines.error.push(
      `hold ledger: ${rehydrated.holds + rehydrated.attempts} session(s) came back HELD from the previous run ` +
        `(${rehydrated.holds} with an answer recorded, ${rehydrated.attempts} with none). Nothing has been re-sent; ` +
        "somebody has to look at those terminals and release them.",
    );
  }
}

/**
 * Open both journals under one process-wide `writer.lock` claim.
 *
 * **ONE CLAIM, THEN TWO FILES.** Two independent locks admit the split brain
 * where two dashboards each win half. A lock loser still folds both files, but
 * the same refusal is handed to each, so neither can append or repair.
 *
 * Nothing here couples their domain rules. A receipt never creates or clears a
 * quarantine hold: the hold ledger remains the one barrier.
 */
export function openFleetActionStores(options: OpenFleetActionStoresOptions = {}): FleetActionStores {
  if (openedStores !== null) {
    return {
      ...openedStores,
      rehydrated: { holds: 0, attempts: 0, skipped: 0 },
      recovery: openedStores.receipts.recovery(),
      unknownWithoutHold: cloneUnknownWithoutHold(startupUnknownWithoutHold ?? []),
      lines: { log: [], error: [] },
    };
  }
  if (sharedQuarantineWasOpened()) {
    throw new Error(
      "the shared quarantine book was built before its ledger was opened, so a send could already have gone out " +
        "with nothing written down. Call openFleetActionStores() before anything that can type — server.ts does it " +
        "above createServer, and tests/fleet-hold-restart.test.ts is what keeps it there.",
    );
  }
  if (receiptsWereHandedOut) {
    throw new Error(
      "the shared receipt journal was handed out before the action stores were opened, so an accepted action could " +
        "already exist with nothing written down. Call openFleetActionStores() before anything that can accept one.",
    );
  }

  const now = options.now ?? (() => Date.now());
  const runId = options.serverInstanceId ?? serverInstanceId();
  const resolved = holdLedgerDir(options.dir);
  if (!resolved.ok) {
    return memoryActionStores(now, runId, [
      `hold ledger: ${resolved.why}. Holds will not survive a restart.`,
      `receipt journal: ${resolved.why}. Action receipts will not survive a restart.`,
    ]);
  }

  try {
    mkdirSync(resolved.dir, { recursive: true, mode: 0o700 });
  } catch (cause) {
    const why = `could not create ${resolved.dir}: ${cause instanceof Error ? cause.message : String(cause)}`;
    return memoryActionStores(now, runId, [
      `hold ledger: ${why}. Holds will not survive a restart.`,
      `receipt journal: ${why}. Action receipts will not survive a restart.`,
    ]);
  }

  const lockPath = join(resolved.dir, LOCK_FILE);
  const taken = takeLock(lockPath, () => new Date(now()));
  const claim: SharedJournalLock = taken.ok
    ? { held: taken.lock, lockedOutBy: null }
    : {
        held: null,
        lockedOutBy:
          `${describeLockRefusal(taken.refusal, lockPath)} ` +
          "This dashboard is reading the hold ledger and receipt journal but not adding to either.",
      };
  ownedStoreLock = claim.held;
  ownedStoreLockPath = claim.held === null ? null : lockPath;

  const report = options.log ?? console.error;
  const hold = openHoldLedger(resolved.dir, {
    lock: claim,
    /* A journal that has quietly stopped writing looks exactly like one that
       is working, so every new trouble reaches the dashboard log immediately. */
    onTrouble: (why) => report(`hold ledger: ${why}`),
  });
  if (hold.kind === "refused") {
    /* The two stores share one writer claim, not one fate. A broken hold file
       must not hide a healthy receipt file: acknowledged queued work can still
       be restored safely, with the hold barrier explicitly memory-only. */
    const receipt = openReceiptJournal(resolved.dir, {
      lock: claim,
      now,
      serverInstanceId: runId,
      onTrouble: (why) => report(`receipt journal: ${why}`),
    });
    if (receipt.kind === "refused") {
      if (ownedStoreLock !== null) releaseLock(ownedStoreLock, lockPath);
      ownedStoreLock = null;
      ownedStoreLockPath = null;
      return memoryActionStores(now, runId, [
        `hold ledger: ${hold.why}. Holds will not survive a restart.`,
        `receipt journal: ${receipt.why}. Action receipts will not survive a restart.`,
      ]);
    }

    sharedReceipts = receipt.journal;
    const { book, rehydrated } = installSharedQuarantineLedger(null, { now, serverInstanceId: runId });
    const log: string[] = [];
    const error = [`hold ledger: ${hold.why}. Holds will not survive a restart.`];
    accountForReceiptJournal(receipt.journal.status(), { log, error });
    const recovery = receipt.journal.recovery();
    const startup: FleetActionStores = {
      book,
      ledger: null,
      receipts: receipt.journal,
      rehydrated,
      recovery,
      unknownWithoutHold: installUnknownWithoutHold(receipt.journal, recovery, book),
      lines: { log, error },
    };
    openedStores = startup;
    return startup;
  }

  const receipt = openReceiptJournal(resolved.dir, {
    lock: claim,
    now,
    serverInstanceId: runId,
    onTrouble: (why) => report(`receipt journal: ${why}`),
  });
  if (receipt.kind === "refused") {
    const receipts = memoryReceiptJournal({ now, serverInstanceId: runId });
    sharedReceipts = receipts;
    const { book, rehydrated } = installSharedQuarantineLedger(hold.ledger, { now, serverInstanceId: runId });
    const holdStatus = hold.ledger.status();
    const log = [`hold ledger → ${holdStatus.dir}`];
    const error = [`receipt journal: ${receipt.why}. Action receipts will not survive a restart.`];
    if (holdStatus.repaired.torn) {
      error.push(`hold ledger: repaired a torn last line (${holdStatus.repaired.droppedBytes} bytes dropped)`);
    }
    if (holdStatus.unreadableLines > 0) error.push(`hold ledger: ${holdStatus.unreadableLines} line(s) could not be read`);
    if (rehydrated.holds + rehydrated.attempts > 0) {
      error.push(
        `hold ledger: ${rehydrated.holds + rehydrated.attempts} session(s) came back HELD from the previous run ` +
          `(${rehydrated.holds} with an answer recorded, ${rehydrated.attempts} with none). Nothing has been re-sent; ` +
          "somebody has to look at those terminals and release them.",
      );
    }
    const recovery = receipts.recovery();
    const startup: FleetActionStores = {
      book,
      ledger: hold.ledger,
      receipts,
      rehydrated,
      recovery,
      unknownWithoutHold: installUnknownWithoutHold(receipts, recovery, book),
      lines: { log, error },
    };
    openedStores = startup;
    return startup;
  }

  sharedReceipts = receipt.journal;
  const { book, rehydrated } = installSharedQuarantineLedger(hold.ledger, { now, serverInstanceId: runId });
  const log: string[] = [];
  const error: string[] = [];
  accountForHoldLedger(hold.ledger.status(), rehydrated, { log, error });

  accountForReceiptJournal(receipt.journal.status(), { log, error });

  const recovery = receipt.journal.recovery();
  const startup: FleetActionStores = {
    book,
    ledger: hold.ledger,
    receipts: receipt.journal,
    rehydrated,
    recovery,
    unknownWithoutHold: installUnknownWithoutHold(receipt.journal, recovery, book),
    lines: { log, error },
  };
  openedStores = startup;
  return startup;
}

/** Forget both singletons and release only the shared lock this composition took. Tests only. */
export function resetFleetActionStoresForTests(): void {
  sharedReceipts?.close();
  resetSharedQuarantineStateForActionStores();
  if (ownedStoreLock !== null && ownedStoreLockPath !== null) {
    releaseLock(ownedStoreLock, ownedStoreLockPath);
  }
  ownedStoreLock = null;
  ownedStoreLockPath = null;
  sharedReceipts = null;
  receiptsWereHandedOut = false;
  openedStores = null;
  startupUnknownWithoutHold = null;
}
