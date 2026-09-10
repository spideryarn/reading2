/**
 * The one composition that owns both durable records of a fleet action.
 *
 * The important assertion is not merely that both stores open: it is that one
 * `writer.lock` claim governs both of them. Two independent claims can split,
 * leaving one dashboard writing holds and another writing receipts, which is
 * a plausible history that never belonged to one process.
 *
 * Nothing here sends a keystroke. Every directory is a fresh `mkdtemp`.
 *
 * docs/plans/260910d § The stores, and who owns them.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openFleetActionStores,
  resetFleetActionStoresForTests,
  sharedUnknownWithoutHold,
  sharedReceiptJournal,
} from "../tools/fleet/action-stores.js";
import { LOCK_FILE, openHoldLedger, type HoldLedger } from "../tools/fleet/hold-ledger.js";
import * as quarantineExports from "../tools/fleet/quarantine.js";
import { sharedQuarantineBook } from "../tools/fleet/quarantine.js";
import { RECEIPTS_FILE } from "../tools/fleet/receipt-journal.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";

const roots: string[] = [];
const ledgers: HoldLedger[] = [];
const outsideLocks: Array<{ dir: string; lock: HeldLock }> = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-action-stores-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  resetFleetActionStoresForTests();
  while (ledgers.length > 0) ledgers.pop()?.close();
  while (outsideLocks.length > 0) {
    const held = outsideLocks.pop();
    if (held) releaseLock(held.lock, join(held.dir, LOCK_FILE));
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

describe("the fleet action stores composition", () => {
  it("exposes the composition only from action-stores", () => {
    expect("openFleetActionStores" in quarantineExports).toBe(false);
    expect("resetFleetActionStoresForTests" in quarantineExports).toBe(false);
    expect("sharedReceiptJournal" in quarantineExports).toBe(false);
    expect("openSharedQuarantine" in quarantineExports).toBe(false);
    expect("resetSharedQuarantineForTests" in quarantineExports).toBe(false);
  });

  it("takes writer.lock once and hands that one claim to both journals", () => {
    const dir = tempRoot();
    const started = openFleetActionStores({
      dir,
      now: () => 1_700_000_000_000,
      serverInstanceId: "7a8b9c0d",
      log: () => {},
    });

    expect(started.book).toBe(sharedQuarantineBook());
    expect(started.book.serverInstanceId).toBe("7a8b9c0d");
    expect(started.receipts).toBe(sharedReceiptJournal());
    expect(started.ledger?.status().lockedOutBy).toBeNull();
    expect(started.receipts.status().lockedOutBy).toBeNull();
    expect(started.receipts.durable()).toBe(true);

    started.ledger?.noteResolved({ at: 1_700_000_000_001, sessionId: "$97900", how: "delivered" });
    started.receipts.noteGeneration(979_000);
    expect(existsSync(join(dir, "holds.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "receipts.jsonl"))).toBe(true);

    /* A third store cannot claim the lock, while both composed stores above
       wrote. If receipts had tried to take a second claim, it would be this
       read-only opener rather than a durable writer. */
    const competitor = openHoldLedger(dir);
    if (competitor.kind !== "open") throw new Error(competitor.why);
    ledgers.push(competitor.ledger);
    expect(competitor.ledger.status().lockedOutBy).not.toBeNull();

    const lockFiles = readdirSync(dir).filter((name) => name.endsWith(".lock"));
    expect(lockFiles).toEqual([LOCK_FILE]);
  });

  it("freezes recovery unknowns after the hold book has rehydrated", () => {
    expect(sharedUnknownWithoutHold()).toBeNull();
    const dir = tempRoot();
    const seeded = openFleetActionStores({
      dir,
      now: () => 1_700_000_000_000,
      serverInstanceId: "7b8c9d0e",
      log: () => {},
    });
    const accept = (sessionId: string, itemId: string) => seeded.receipts.accept({
      requestId: null,
      fingerprint: null,
      op: "queued-message",
      origin: "enqueue",
      actor: { kind: "client-claimed", id: "greg" },
      speaker: "greg",
      target: { sessionId, paneId: null, claudeSessionId: null, tmuxGeneration: 980_000 },
      what: "message (6 characters)",
      queue: { itemId, enqueuedAt: 1_700_000_000_000 },
      material: { kind: "message", text: "pinned", speaker: "greg" },
    });
    const first = accept("$97905", "7b8c9d0e-q1");
    const second = accept("$97905", "7b8c9d0e-q2");
    const held = accept("$97906", "7b8c9d0e-q3");
    if (!first.ok || !second.ok || !held.ok) throw new Error("the seed receipts were refused");
    expect(seeded.receipts.attempted(first.receiptId).landed).toBe(true);
    expect(seeded.receipts.attempted(second.receiptId).landed).toBe(true);
    expect(seeded.receipts.attempted(held.receiptId).landed).toBe(true);
    seeded.book.noteAttempt({
      sessionId: "$97906",
      paneId: null,
      claudeSessionId: null,
      origin: "queued-delivery",
      what: "message (6 characters)",
    });
    resetFleetActionStoresForTests();

    const restarted = openFleetActionStores({
      dir,
      now: () => 1_700_000_001_000,
      serverInstanceId: "8c9d0e1f",
      log: () => {},
    });
    expect(restarted.book.holding("$97906")).not.toBeNull();
    expect(restarted.unknownWithoutHold).toEqual([
      { sessionId: "$97905", receiptIds: [first.receiptId, second.receiptId] },
    ]);

    restarted.unknownWithoutHold[0]?.receiptIds.push("caller-mutation");
    restarted.unknownWithoutHold.push({ sessionId: "$mutated", receiptIds: [] });
    const fromAccessor = sharedUnknownWithoutHold();
    expect(fromAccessor).toEqual([
      { sessionId: "$97905", receiptIds: [first.receiptId, second.receiptId] },
    ]);
    fromAccessor?.[0]?.receiptIds.push("second-caller-mutation");
    expect(openFleetActionStores().unknownWithoutHold).toEqual([
      { sessionId: "$97905", receiptIds: [first.receiptId, second.receiptId] },
    ]);
  });

  it("includes conservative recovery conclusions when this process cannot write", () => {
    const dir = tempRoot();
    const seeded = openFleetActionStores({
      dir,
      now: () => 1_700_000_000_000,
      serverInstanceId: "8d9e0f1a",
      log: () => {},
    });
    const accepted = seeded.receipts.accept({
      requestId: null,
      fingerprint: null,
      op: "queued-action",
      origin: "enqueue",
      actor: { kind: "client-claimed", id: "greg" },
      speaker: "greg",
      target: { sessionId: "$97907", paneId: null, claudeSessionId: null, tmuxGeneration: 980_000 },
      what: "action continue",
      queue: { itemId: "8d9e0f1a-q1", enqueuedAt: 1_700_000_000_000 },
    });
    if (!accepted.ok) throw new Error("the seed receipt was refused");
    expect(seeded.receipts.attempted(accepted.receiptId).landed).toBe(true);
    resetFleetActionStoresForTests();
    appendFileSync(
      join(dir, RECEIPTS_FILE),
      `${JSON.stringify({ schema: 1, kind: "attempted", at: "unreadable", receiptId: accepted.receiptId })}\n`,
    );

    const taken = takeLock(join(dir, LOCK_FILE), () => new Date(1_700_000_001_000));
    if (!taken.ok) throw new Error("the test could not plant its live writer lock");
    outsideLocks.push({ dir, lock: taken.lock });
    const restarted = openFleetActionStores({
      dir,
      now: () => 1_700_000_001_000,
      serverInstanceId: "9e0f1a2b",
      log: () => {},
    });
    expect(restarted.recovery.wouldConclude).toContainEqual({
      receiptId: accepted.receiptId,
      state: "outcome-unknown",
      reason: "recovery-blocked",
    });
    expect(restarted.unknownWithoutHold).toEqual([
      { sessionId: "$97907", receiptIds: [accepted.receiptId] },
    ]);
  });

  it("opens both journals read-only when another dashboard owns the shared claim", () => {
    const dir = tempRoot();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const taken = takeLock(join(dir, LOCK_FILE), () => new Date(1_700_000_000_000));
    if (!taken.ok) throw new Error("the test could not plant its live writer lock");
    outsideLocks.push({ dir, lock: taken.lock });

    const started = openFleetActionStores({
      dir,
      now: () => 1_700_000_000_000,
      serverInstanceId: "8b9c0d1e",
      log: () => {},
    });

    expect(started.ledger).not.toBeNull();
    expect(started.ledger?.status().lockedOutBy).toMatch(/writer|lock|read-only/i);
    expect(started.receipts.status().lockedOutBy).toMatch(/writer|lock|read-only/i);
    expect(started.receipts.status().lockedOutBy).toBe(started.ledger?.status().lockedOutBy);
    expect(started.receipts.durable()).toBe(false);

    started.ledger?.noteResolved({ at: 1_700_000_000_001, sessionId: "$97901", how: "delivered" });
    started.receipts.noteGeneration(979_001);
    expect(existsSync(join(dir, "holds.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "receipts.jsonl"))).toBe(false);
  });

  it("rehydrates the quarantine through the action-store composition", () => {
    const dir = tempRoot();
    const seeded = openHoldLedger(dir);
    if (seeded.kind !== "open") throw new Error(`the seed ledger would not open: ${seeded.why}`);
    ledgers.push(seeded.ledger);
    seeded.ledger.noteAttempt({
      at: 1_700_000_000_000,
      sessionId: "$97902",
      paneId: "%97902",
      claudeSessionId: null,
      origin: "direct-steer",
      what: "message (11 characters)",
      serverInstanceId: "1a2b3c4d",
      tmuxGeneration: 979_001,
    });
    seeded.ledger.close();

    const started = openFleetActionStores({
      dir,
      now: () => 1_700_000_001_000,
      serverInstanceId: "9c0d1e2f",
      log: () => {},
    });

    expect(started.rehydrated).toEqual({ holds: 0, attempts: 1, skipped: 0 });
    expect(started.book.holding("$97902")).not.toBeNull();
    expect(started.lines.log.join(" ")).toContain("hold ledger");
    expect(started.lines.error.join(" ")).toContain("came back HELD");
    expect(started.recovery).toEqual(started.receipts.recovery());
  });

  it("installs both shared stores through the action-store composition", () => {
    const dir = tempRoot();
    const started = openFleetActionStores({ dir, log: () => {} });

    expect(started.book).toBe(sharedQuarantineBook());
    expect(started.ledger).not.toBeNull();
    expect(sharedReceiptJournal().durable()).toBe(true);
    expect(started.lines.log.join(" ")).toContain("hold ledger");
  });

  it("keeps the hold ledger durable when only the receipt journal cannot open", () => {
    const dir = tempRoot();
    writeFileSync(join(dir, "material"), "blocks the receipt material directory");

    const started = openFleetActionStores({ dir, log: () => {} });
    expect(started.ledger).not.toBeNull();
    expect(started.ledger?.status().lockedOutBy).toBeNull();
    expect(sharedReceiptJournal().durable()).toBe(false);

    started.ledger?.noteResolved({ at: 1_700_000_000_001, sessionId: "$97903", how: "delivered" });
    expect(existsSync(join(dir, "holds.jsonl"))).toBe(true);
  });

  it("keeps healthy durable receipts when only the hold ledger cannot open", () => {
    const dir = tempRoot();
    const seeded = openFleetActionStores({
      dir,
      now: () => 1_700_000_000_000,
      serverInstanceId: "ad0e1f2a",
      log: () => {},
    });
    const accepted = seeded.receipts.accept({
      requestId: null,
      fingerprint: null,
      op: "queued-message",
      origin: "enqueue",
      actor: { kind: "client-claimed", id: "greg" },
      speaker: "greg",
      target: {
        sessionId: "$97908",
        paneId: null,
        claudeSessionId: "35f36cc5-1504-4340-8977-d0cf7982debb",
        tmuxGeneration: 980_000,
      },
      what: "message (6 characters)",
      queue: { itemId: "ad0e1f2a-q1", enqueuedAt: 1_700_000_000_000 },
      material: { kind: "message", text: "pinned", speaker: "greg" },
    });
    expect(accepted).toMatchObject({ ok: true, durable: true });
    resetFleetActionStoresForTests();

    // A directory where the JSONL file belongs makes only the hold ledger
    // unreadable. The independent receipt file and its material remain valid.
    mkdirSync(join(dir, "holds.jsonl"));
    const restarted = openFleetActionStores({
      dir,
      now: () => 1_700_000_001_000,
      serverInstanceId: "be1f2a3b",
      log: () => {},
    });

    expect(restarted.ledger).toBeNull();
    expect(restarted.receipts.durable()).toBe(true);
    expect(restarted.receipts.restorable()).toHaveLength(1);
    expect(restarted.receipts.restorable()[0]?.queue.itemId).toBe("ad0e1f2a-q1");
  });

  it("reset is idempotent and gives the composition-owned lock back", () => {
    const dir = tempRoot();
    openFleetActionStores({ dir, log: () => {} });
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);

    resetFleetActionStoresForTests();
    resetFleetActionStoresForTests();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);

    const taken = takeLock(join(dir, LOCK_FILE), () => new Date(1_700_000_000_000));
    expect(taken.ok).toBe(true);
    if (taken.ok) outsideLocks.push({ dir, lock: taken.lock });
  });

  it("closing one handed-in journal makes only that journal report read-only", () => {
    const dir = tempRoot();
    const started = openFleetActionStores({ dir, log: () => {} });
    started.receipts.noteGeneration(979_004);
    started.receipts.close();

    expect(started.receipts.durable()).toBe(false);
    expect(started.receipts.status().lockedOutBy).toMatch(/closed/i);
    started.ledger?.noteResolved({ at: 1_700_000_000_001, sessionId: "$97904", how: "delivered" });
    expect(existsSync(join(dir, "holds.jsonl"))).toBe(true);
  });

  it("throws when the shared quarantine book was handed out before durable startup", () => {
    const dir = tempRoot();
    sharedQuarantineBook();
    expect(() => openFleetActionStores({ dir, log: () => {} })).toThrow(/before (?:its ledger|the action stores) (?:was|were) opened/);
  });

  it("throws when the shared receipt journal was handed out before durable startup", () => {
    const dir = tempRoot();
    expect(sharedReceiptJournal().status()).toMatchObject({ neverOpened: true });
    expect(sharedReceiptJournal().status().lockedOutBy).toMatch(/never opened/i);
    expect(() => openFleetActionStores({ dir, log: () => {} })).toThrow(/receipt journal.*before.*opened/i);
  });
});
