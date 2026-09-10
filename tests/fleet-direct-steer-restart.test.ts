/**
 * Direct steer receipts across a frozen-disk process boundary — plan 260910d,
 * § The crash points, for a direct message.
 *
 * Every reboot discards the routes, coordinator, book and journals; only bytes
 * under a fresh temporary directory cross. A crash is a disk which stops
 * accepting bytes (`tests/helpers/fleet-frozen-disk.ts`), and the fake
 * transport records keystrokes only while the disk is alive — a dead process
 * types nothing. No transport here reaches tmux.
 *
 * "A duplicate HTTP request after a restart" is the same envelope posted to a
 * fresh composition over the same directory. It must return the stored receipt
 * and make zero transport calls.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { openHoldLedger } from "../tools/fleet/hold-ledger.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { openReceiptJournal, type ReceiptJournal, type ReceiptState } from "../tools/fleet/receipt-journal.js";
import { createRateLimiter, makeSteerRoutes, type SteerRoutes } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { FrozenDisk } from "./helpers/fleet-frozen-disk.js";

const NOW = 1_800_400_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const SESSION = "$97801";
const PANE = "%97801";
const PANE_PID = 978_010;

type Key = { kind: "text" } | { kind: "enter" };
type Transport = (target: SteerTarget, text: string) => SteerResult;

const roots: string[] = [];
const activeLocks: Array<{ lock: HeldLock; path: string }> = [];

afterEach(() => {
  while (activeLocks.length > 0) {
    const entry = activeLocks.pop();
    if (entry === undefined) continue;
    try {
      releaseLock(entry.lock, entry.path);
    } catch {
      // Already released at a simulated process boundary.
    }
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-direct-steer-restart-"));
  roots.push(dir);
  return dir;
}

function sent(target: SteerTarget): SteerResult {
  return {
    ok: true,
    verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
    sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"], ["send-keys", "-t", target.paneId, "Enter"]],
  };
}

/** A transport that records keys only while the simulated process is alive. */
function recording(disk: FrozenDisk, keys: Key[]): Transport {
  return (target) => {
    if (!disk.isFrozen()) keys.push({ kind: "text" }, { kind: "enter" });
    return sent(target);
  };
}

type Boot = { routes: SteerRoutes; receipts: ReceiptJournal; book: QuarantineBook; crash(): void };

function boot(dir: string, runId: string, options: { disk?: FrozenDisk; transport?: Transport } = {}): Boot {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, "writer.lock");
  const taken = takeLock(lockPath, () => new Date(NOW));
  if (!taken.ok) throw new Error("could not take the test writer lock");
  activeLocks.push({ lock: taken.lock, path: lockPath });
  const claim = { held: taken.lock, lockedOutBy: null };
  const disk = options.disk ?? new FrozenDisk();
  const ledger = openHoldLedger(dir, { lock: claim, writeLine: disk.writer("holds") });
  if (ledger.kind !== "open") throw new Error(ledger.why);
  const opened = openReceiptJournal(dir, { lock: claim, now: () => NOW, serverInstanceId: runId, writeLine: disk.writer("receipts") });
  if (opened.kind !== "open") throw new Error(opened.why);
  const book = new QuarantineBook({ now: () => NOW, serverInstanceId: runId, ledger: ledger.ledger });
  book.rehydrate();
  const transport =
    options.transport ??
    (() => {
      throw new Error("this composition must not type");
    });
  const send = makeSendCoordinator({
    book,
    sendMessage: (target, text) => transport(target, text),
    answerQuestion: () => {
      throw new Error("these tests never answer a dialog");
    },
  });
  const routes = makeSteerRoutes({
    send,
    receipts: opened.journal,
    now: () => NOW,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
    answeringEnabled: () => true,
  });
  let crashed = false;
  return {
    routes,
    receipts: opened.journal,
    book,
    crash() {
      if (crashed) return;
      crashed = true;
      const index = activeLocks.findIndex((entry) => entry.lock === taken.lock);
      if (index >= 0) activeLocks.splice(index, 1);
      releaseLock(taken.lock, lockPath);
    },
  };
}

async function post(routes: SteerRoutes, body: Record<string, unknown>): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const stream = new PassThrough();
  stream.write(JSON.stringify(body));
  stream.end();
  const req = Object.assign(stream, {
    url: "/api/steer/message",
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as IncomingMessage;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const seen: { status: number | null; body: string } = { status: null, body: "" };
  const res = {
    writeHead(status: number) {
      seen.status = status;
      return res;
    },
    end(chunk?: string) {
      seen.body = chunk ?? "";
      finish();
      return res;
    },
  } as unknown as ServerResponse;
  expect(routes.handle(req, res)).toBe(true);
  await done;
  return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

function envelope(conversationId: string, text: string, keyed = true): Record<string, unknown> {
  return {
    ...(keyed ? { requestId: `rq-${NOW.toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 24)}` } : {}),
    paneId: PANE,
    sessionId: SESSION,
    claudeSessionId: conversationId,
    panePid: PANE_PID,
    status: { kind: "idle" },
    speaker: "greg",
    text,
  };
}

function receiptOf(journal: ReceiptJournal, body: Record<string, unknown>): ReceiptState | null {
  return journal.byRequestId(String(body.requestId));
}

/** The duplicate request after a restart: a stored receipt, and zero keystrokes. */
async function expectReplay(dir: string, runId: string, body: Record<string, unknown>, state: string, reason: string): Promise<void> {
  const keys: Key[] = [];
  const disk = new FrozenDisk();
  const again = boot(dir, runId, { disk, transport: recording(disk, keys) });
  const replay = await post(again.routes, body);
  expect(replay.status).toBe(200);
  expect(replay.json).toMatchObject({ ok: true, op: "receipt", replay: true, receipt: { state, reason, pending: false } });
  expect(keys).toEqual([]);
}

describe("a direct message across a frozen-disk restart", () => {
  it("before accepted lands: no receipt, and the retry is accepted as new and sends once", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a901a901", { disk, transport: recording(disk, keys) });
    disk.arm({ store: "receipts", kind: "accepted", mode: "before" });
    const body = envelope(conversationId, "acceptance never reached the disk");
    await post(first.routes, body);
    expect(keys).toEqual([]);
    first.crash();

    const retryKeys: Key[] = [];
    const retryDisk = new FrozenDisk();
    const second = boot(dir, "b901b901", { disk: retryDisk, transport: recording(retryDisk, retryKeys) });
    expect(second.receipts.recent(10)).toEqual([]);
    const retry = await post(second.routes, body);
    expect(retry.status).toBe(200);
    expect(retry.json.op).toBe("message");
    expect(retryKeys.map((key) => key.kind)).toEqual(["text", "enter"]);
  });

  it("after accepted, before attempted: proven not attempted, and a duplicate sends nothing", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a902a902", { disk, transport: recording(disk, keys) });
    disk.arm({ store: "receipts", kind: "accepted", mode: "after" });
    const body = envelope(conversationId, "accepted and then the process died");
    await post(first.routes, body);
    expect(keys).toEqual([]);
    first.crash();

    const second = boot(dir, "b902b902");
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "not-sent", reason: "interrupted-before-attempt" });
    second.crash();
    await expectReplay(dir, "c902c902", body, "not-sent", "interrupted-before-attempt");
  });

  it("an unkeyed direct send found at accepted is proven not attempted too", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a903a903", { disk, transport: recording(disk, []) });
    disk.arm({ store: "receipts", kind: "accepted", mode: "after" });
    await post(first.routes, envelope(conversationId, "unkeyed, accepted, then dead", false));
    first.crash();

    const second = boot(dir, "b903b903");
    expect(second.receipts.recent(1)[0]?.last).toMatchObject({ state: "not-sent", reason: "interrupted-before-attempt" });
  });

  it("after attempted, before the coordinator: outcome-unknown, and a duplicate sends nothing", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a904a904", { disk, transport: recording(disk, keys) });
    disk.arm({ store: "receipts", kind: "attempted", mode: "after" });
    const body = envelope(conversationId, "attempted and then the process died");
    await post(first.routes, body);
    expect(keys).toEqual([]);
    first.crash();

    const second = boot(dir, "b904b904");
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    second.crash();
    await expectReplay(dir, "c904c904", body, "outcome-unknown", "interrupted");
  });

  it("between the text and the Enter: outcome-unknown, and the session comes back held", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a905a905", {
      disk,
      transport: (target) => {
        keys.push({ kind: "text" });
        disk.freeze();
        return {
          ok: false,
          reason: { code: "send-failed", why: "the process stopped between the text and the Enter" },
          delivery: "partial",
          sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"]],
        };
      },
    });
    const body = envelope(conversationId, "freeze between the two send-keys calls");
    await post(first.routes, body);
    expect(keys.map((key) => key.kind)).toEqual(["text"]);
    first.crash();

    const second = boot(dir, "b905b905");
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    expect(second.book.holding(SESSION)).not.toBeNull();
  });

  it("after the send, before the outcome line: outcome-unknown, and a duplicate sends nothing", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a906a906", {
      disk,
      transport: (target) => {
        keys.push({ kind: "text" }, { kind: "enter" });
        disk.freeze("receipts");
        return sent(target);
      },
    });
    const body = envelope(conversationId, "the outcome line will not land");
    await post(first.routes, body);
    first.crash();

    const second = boot(dir, "b906b906");
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    second.crash();
    await expectReplay(dir, "c906c906", body, "outcome-unknown", "interrupted");
    expect(keys).toHaveLength(2);
  });

  it("during the outcome line: the torn tail is repaired and the attempt decides", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a907a907", { disk, transport: recording(disk, []) });
    disk.arm({ store: "receipts", kind: "outcome", mode: "torn" });
    const body = envelope(conversationId, "tear the outcome record");
    await post(first.routes, body);
    first.crash();

    const second = boot(dir, "b907b907");
    expect(second.receipts.status().repaired.torn).toBe(true);
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
  });

  it("an unreadable complete attempted line mid-file blocks that receipt", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a908a908", { disk, transport: recording(disk, []) });
    disk.arm({ store: "receipts", kind: "attempted", mode: "unreadable" });
    const one = envelope(conversationId, "the attempted line of this one is unreadable");
    await post(first.routes, one);
    const two = envelope(conversationId, "a later valid send makes that line mid-file");
    expect((await post(first.routes, two)).status).toBe(200);
    first.crash();

    const second = boot(dir, "b908b908");
    expect(receiptOf(second.receipts, one)?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    expect(receiptOf(second.receipts, two)?.last).toMatchObject({ state: "keys-submitted" });
  });

  it("after the outcome, before the HTTP response: keys-submitted, and a duplicate sends nothing", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a909a909", { disk, transport: recording(disk, keys) });
    disk.arm({ store: "receipts", kind: "outcome", mode: "after" });
    const body = envelope(conversationId, "the response to this one was lost");
    await post(first.routes, body);
    expect(keys.map((key) => key.kind)).toEqual(["text", "enter"]);
    first.crash();

    const second = boot(dir, "b909b909");
    expect(receiptOf(second.receipts, body)?.last).toMatchObject({ state: "keys-submitted", reason: "transport-ok" });
    second.crash();
    await expectReplay(dir, "c909c909", body, "keys-submitted", "transport-ok");
  });
});
