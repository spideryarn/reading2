/**
 * **WHETHER A HOLD SURVIVES A RESTART, AS THE BOOK ITSELF CAN SAY IT.**
 *
 * `scripts/fleet-restart-plan.ts` lets a restart go ahead over a steering hold
 * only when the dashboard says `holdsDurable: true` on its catalogue — because
 * since 260908j Stage 4b the hold ledger rehydrates holds at startup, but only
 * when the ledger is actually writing. This is where that answer comes from:
 * `QuarantineBook.durable()`, read off the ledger's own status rather than
 * assumed from the fact that a ledger was handed in.
 *
 * Four states, and only one of them is durable: a book with no ledger (memory
 * only), a ledger another dashboard holds the lock for (read-only here), and a
 * ledger whose last write failed are all a restart that may lose a hold.
 */
import { mkdtempSync, rmSync, unlinkSync, writeSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openHoldLedger, type HoldLedger } from "../tools/fleet/hold-ledger.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { memoryReceiptJournal } from "../tools/fleet/receipt-journal.js";
import { makeActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";

const NOW = 1_800_000_000_000;
const HOST = "100.90.80.70:8787";

const roots: string[] = [];
const ledgers: HoldLedger[] = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "holds-durable-"));
  roots.push(dir);
  return dir;
}

function ledgerIn(dir: string, writeLine?: (fd: number, line: string) => void): HoldLedger {
  const opened = openHoldLedger(dir, writeLine === undefined ? {} : { writeLine });
  if (opened.kind !== "open") throw new Error(`expected the ledger to open: ${opened.why}`);
  ledgers.push(opened.ledger);
  return opened.ledger;
}

function book(ledger: HoldLedger | null): QuarantineBook {
  return new QuarantineBook({ now: () => 1_800_000_000_000, serverInstanceId: "b1c2d3e4", ledger });
}

describe("QuarantineBook.durable — whether a hold opened now would survive a restart", () => {
  it("is false for a book with no ledger", () => {
    expect(book(null).durable()).toBe(false);
  });

  it("is true for a book over a ledger that holds the writer lock and has not failed", () => {
    expect(book(ledgerIn(tempDir())).durable()).toBe(true);
  });

  it("is false over a ledger another opener holds the lock for", () => {
    const dir = tempDir();
    ledgerIn(dir);
    const reader = ledgerIn(dir);
    expect(reader.status().lockedOutBy).not.toBeNull();
    expect(book(reader).durable()).toBe(false);
  });

  it("is false once the ledger's last write has failed", () => {
    const failing = ledgerIn(tempDir(), () => {
      throw new Error("ENOSPC: no space left on device");
    });
    const b = book(failing);
    b.noteAttempt({ sessionId: "$7301", paneId: "%7301", claudeSessionId: null, origin: "direct-steer", what: "message (4 characters)" });
    expect(failing.status().failure).not.toBeNull();
    expect(b.durable()).toBe(false);
  });

  it("is false when the writer lock is lost after opening, before another write notices", () => {
    const dir = tempDir();
    const ledger = ledgerIn(dir);
    const b = book(ledger);
    expect(b.durable()).toBe(true);

    unlinkSync(join(dir, "writer.lock"));

    expect(b.durable()).toBe(false);
  });

  it("stays false when a later successful write clears the failure but an open hold was never recorded", () => {
    let fail = true;
    const ledger = ledgerIn(tempDir(), (fd, line) => {
      if (fail) throw new Error("ENOSPC: no space left on device");
      writeSync(fd, line);
    });
    const b = book(ledger);
    b.hold({
      sessionId: "$7302",
      paneId: "%7302",
      claudeSessionId: null,
      reading: "unknown",
      origin: "direct-steer",
      what: "message (4 characters)",
    });
    fail = false;
    b.noteAttempt({ sessionId: "$7303", paneId: "%7303", claudeSessionId: null, origin: "direct-steer", what: "message (5 characters)" });
    expect(ledger.status().failure).toBeNull();

    expect(b.durable()).toBe(false);
  });
});

/**
 * **AND THE CATALOGUE SAYS SO**, because that is the one place
 * `scripts/fleet-restart-plan.ts` reads. A top-level field on the envelope
 * rather than on `QueueView`: the web client builds a queue view field by field
 * from the wire type, so a new required field there would stop it compiling,
 * and the client ignores top-level fields it does not read.
 */
describe("GET /api/actions says whether holds survive a restart", () => {
  function catalogueOver(b: QuarantineBook): Record<string, unknown> {
    const refuse = (): never => {
      throw new Error("nothing in this test may send");
    };
    const routes = makeActionRoutes({
      queue: new SteeringQueue({
        now: () => NOW,
        serverInstanceId: b.serverInstanceId,
        quarantine: b,
        receipts: memoryReceiptJournal({ now: () => NOW, serverInstanceId: b.serverInstanceId }),
      }),
      send: makeSendCoordinator({ book: b, sendMessage: refuse, answerQuestion: refuse }),
      now: () => NOW,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => false,
      yieldToLoop: () => Promise.resolve(),
    });
    let status: number | null = null;
    let body = "";
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end(chunk?: string) {
        body = chunk ?? "";
        return res;
      },
    };
    const req = {
      url: "/api/actions",
      method: "GET",
      headers: { host: HOST, origin: `http://${HOST}` },
      socket: { remoteAddress: "100.90.80.71" },
    };
    expect(routes.handle(req as unknown as IncomingMessage, res as unknown as ServerResponse)).toBe(true);
    expect(status).toBe(200);
    return JSON.parse(body) as Record<string, unknown>;
  }

  it("is true over a ledger that is writing", () => {
    expect(catalogueOver(book(ledgerIn(tempDir()))).holdsDurable).toBe(true);
  });

  it("is false over a memory-only book, and false is a boolean, not an absence", () => {
    const catalogue = catalogueOver(book(null));
    expect(catalogue).toHaveProperty("holdsDurable");
    expect(catalogue.holdsDurable).toBe(false);
  });
});
