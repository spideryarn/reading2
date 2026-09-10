/**
 * **THE FOUR GUARANTEES A MUTATION RUN FOUND UNGUARDED.**
 *
 * Stage 1 of docs/plans/260910d was mutation-tested over 22 mutations
 * (`260910d-durable-action-receipts-stage1-mutation-task.md`). Seventeen were
 * killed; of the five that survived, one is equivalent (a restore guard the
 * next line repeats) and four were real holes, because the suite only ever
 * named the thing it should have measured:
 *
 *  - retention and request-id skew were used by their constant NAMES, so
 *    changing a constant's VALUE moved every assertion with it — the retention
 *    promise and the "a forgotten id is refused, never new" proof both went
 *    unguarded;
 *  - no test took `writer.lock` away while a journal was open, so the
 *    `stillOurs` check before each append could be deleted;
 *  - no test gave a refused opener a torn tail, so repairing before taking the
 *    lock — cutting the live owner's file — went unnoticed.
 *
 * Each test below was run against its mutation and seen red.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { openJournalFile, type JournalFile, type OpenJournalFileOptions } from "../tools/fleet/journal-file.js";
import {
  admitUnknownRequestId,
  openReceiptJournal,
  REQUEST_ID_SKEW_MS,
  RETENTION_MS,
} from "../tools/fleet/receipt-journal.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const roots: string[] = [];
const opened: JournalFile<Row>[] = [];
const locks: { lock: HeldLock; path: string }[] = [];

afterEach(() => {
  for (const journal of opened.splice(0)) journal.close();
  for (const { lock, path } of locks.splice(0)) releaseLock(lock, path);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Row = { n: number };

const FILE = "guard.jsonl";

const OPTIONS: OpenJournalFileOptions<Row> = {
  file: FILE,
  parse: (line) => {
    try {
      const value = JSON.parse(line) as unknown;
      return typeof value === "object" && value !== null && typeof (value as Row).n === "number" ? (value as Row) : null;
    } catch {
      return null;
    }
  },
  serialise: (row) => `${JSON.stringify(row)}\n`,
  directoryLabel: "guard journal directory",
  lockRefusalSuffix: "This opener reads but does not write.",
  unavailableSuffix: "Nothing written here is durable.",
  closedBy: "closed",
};

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "receipt-guards-"));
  roots.push(dir);
  return dir;
}

function open(dir: string): JournalFile<Row> {
  const result = openJournalFile(dir, OPTIONS);
  if (result.kind !== "open") throw new Error(`expected the journal to open: ${result.why}`);
  opened.push(result.journal);
  return result.journal;
}

describe("retention and request-id freshness are pinned by value, not only by name", () => {
  it("retains a keyed receipt for seven days and a request id's skew is one hour", () => {
    // Pinned outright: the plan's proof that a forgotten id is always refused
    // is arithmetic over exactly these two numbers (§ Retention).
    expect(RETENTION_MS).toBe(7 * DAY);
    expect(REQUEST_ID_SKEW_MS).toBe(HOUR);
  });

  it("still finds a concluded keyed receipt six days after acceptance, through a compaction", () => {
    let now = 1_800_000_000_000;
    // A DURABLE journal, because a keyed accept fails closed when it cannot
    // land (Stage 1a review F22) — a memory-only journal refuses every keyed
    // receipt, which is correct and is not what this test is about.
    const dir = tempDir();
    const lockPath = join(dir, "writer.lock");
    const taken = takeLock(lockPath, () => new Date(now));
    if (!taken.ok) throw new Error("expected the test's own lock");
    locks.push({ lock: taken.lock, path: lockPath });
    const openedJournal = openReceiptJournal(dir, {
      lock: { held: taken.lock, lockedOutBy: null },
      now: () => now,
      serverInstanceId: "a1b2c3d4",
    });
    if (openedJournal.kind !== "open") throw new Error(openedJournal.why);
    const journal = openedJournal.journal;
    const accepted = journal.accept({
      requestId: "rq-guard-aaaaaaaaaaaaaaaa",
      fingerprint: "f".repeat(64),
      op: "queued-message",
      origin: "enqueue",
      actor: { kind: "client-claimed", id: "greg" },
      speaker: "greg",
      target: { sessionId: "$4101", paneId: null, claudeSessionId: null, tmuxGeneration: null },
      queue: null,
      what: "message (3 characters)",
    });
    if (!accepted.ok) throw new Error(accepted.why);
    // Terminal, because retention never evicts a non-terminal receipt and this
    // test is about the terminal rule.
    expect(
      journal.outcome(accepted.receiptId, { state: "not-sent", reason: "undeliverable", code: null, why: "guard" }),
    ).toBe(true);
    now += 6 * DAY;
    expect(journal.compact()).toBe(true);
    expect(journal.byRequestId("rq-guard-aaaaaaaaaaaaaaaa")?.receiptId).toBe(accepted.receiptId);
  });

  it("refuses, as unknown, an id just old enough that compaction could have forgotten it", () => {
    const now = 1_800_000_000_000;
    // A receipt is kept 7 days after acceptance, and acceptance was within an
    // hour of the id's mint time — so an id minted before now − 7d + 1h may
    // already be gone, and must never be admitted as new.
    expect(admitUnknownRequestId(now - RETENTION_MS + REQUEST_ID_SKEW_MS + 1, now)).toBe(false);
    expect(admitUnknownRequestId(now - 7 * DAY, now)).toBe(false);
    expect(admitUnknownRequestId(now - HOUR, now)).toBe(true);
  });
});

describe("the physical core keeps one writer", () => {
  it("stops appending the moment writer.lock is no longer this process's", () => {
    const dir = tempDir();
    const journal = open(dir);
    expect(journal.append({ n: 1 })).toBe(true);
    // Another claimant overwrites the record in place — same inode, a different
    // instance — which is the case `stillOurs`'s record check exists for.
    writeFileSync(
      join(dir, "writer.lock"),
      `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "h", startedAt: new Date(0).toISOString() })}\n`,
    );
    const before = readFileSync(join(dir, FILE), "utf8");
    expect(journal.append({ n: 2 })).toBe(false);
    expect(readFileSync(join(dir, FILE), "utf8")).toBe(before);
    expect(journal.status().lockedOutBy).not.toBeNull();
  });

  it("an opener that is refused the lock does not repair — and so cannot cut — the owner's torn tail", () => {
    const dir = tempDir();
    const owner = open(dir);
    expect(owner.append({ n: 1 })).toBe(true);
    // The owner is mid-write: a partial last line with no newline yet.
    appendFileSync(join(dir, FILE), '{"n":2');
    const before = readFileSync(join(dir, FILE), "utf8");
    const reader = open(dir);
    expect(reader.status().lockedOutBy).not.toBeNull();
    expect(readFileSync(join(dir, FILE), "utf8")).toBe(before);
  });
});
