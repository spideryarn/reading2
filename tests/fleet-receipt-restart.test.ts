/**
 * Stage 1b's process-boundary acceptance tests.
 *
 * Every reboot below discards the queue, routes, quarantine book, coordinator,
 * journals and writer claim. Only bytes under a fresh temporary directory
 * cross the boundary. A crash is represented by a disk which stops accepting
 * bytes, not by an exception: exceptions run catch/finally code which a dead
 * process never reaches.
 *
 * No transport in this file reaches tmux. The fake records the two conceptual
 * keystrokes (literal text and Enter) in memory and returns injected evidence.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { actionById, type SpokenAction } from "../tools/fleet/actions.js";
import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import { openHoldLedger, type HoldLedger } from "../tools/fleet/hold-ledger.js";
import { openReceiptJournal, type ReceiptJournal } from "../tools/fleet/receipt-journal.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { makeActionRoutes, type ActionDeps, type ActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";

const SESSION_A = "$98601";
const SESSION_B = "$98602";
const PANE_A = "%98601";
const PANE_B = "%98602";
const PANE_PID = 986_010;
const GENERATION = 986_001;
const NOW = 1_800_100_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const GREG_PREFIX = "[Greg, via the fleet dashboard] ";

type StoreName = "holds" | "receipts";
type RecordLabel = { store: StoreName; kind: string; receiptId: string | null };
type Rule = {
  store: StoreName;
  kind: string;
  receiptId?: string | undefined;
  mode: "before" | "after" | "torn" | "throw" | "unreadable" | "malformed";
};

/** A disk which can stop at one named append and silently drop everything later. */
class FrozenDisk {
  private rule: Rule | null = null;
  private frozen = new Set<StoreName>();

  arm(rule: Rule): void {
    this.rule = rule;
  }

  freeze(store?: StoreName): void {
    if (store === undefined) {
      this.frozen.add("holds");
      this.frozen.add("receipts");
    } else {
      this.frozen.add(store);
    }
  }

  writer(store: StoreName): (fd: number, line: string) => void {
    return (fd, line) => {
      if (this.frozen.has(store)) return;
      const label = this.label(store, line);
      const rule = this.rule;
      const matches =
        rule !== null &&
        rule.store === label.store &&
        rule.kind === label.kind &&
        (rule.receiptId === undefined || rule.receiptId === label.receiptId);
      if (!matches || rule === null) {
        writeSync(fd, line);
        return;
      }
      this.rule = null;
      switch (rule.mode) {
        case "before":
          this.freeze();
          return;
        case "after":
          writeSync(fd, line);
          this.freeze();
          return;
        case "torn":
          writeSync(fd, line.slice(0, Math.max(1, line.length - 9)));
          this.freeze();
          return;
        case "throw":
          throw new Error(`disk full while writing ${store} ${label.kind}`);
        case "unreadable": {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          writeSync(fd, `${JSON.stringify({ ...parsed, at: "not-a-number" })}\n`);
          return;
        }
        case "malformed":
          writeSync(fd, "these bytes are not json\n");
          return;
        default: {
          const never: never = rule.mode;
          throw new Error(`unknown frozen-disk mode ${String(never)}`);
        }
      }
    };
  }

  private label(store: StoreName, line: string): RecordLabel {
    const parsed = JSON.parse(line) as { kind?: unknown; receiptId?: unknown };
    return {
      store,
      kind: typeof parsed.kind === "string" ? parsed.kind : "unreadable",
      receiptId: typeof parsed.receiptId === "string" ? parsed.receiptId : null,
    };
  }
}

type Key = { kind: "text"; text: string } | { kind: "enter" };
type Transport = (target: SteerTarget, text: string, status: FleetStatus) => SteerResult;

type Boot = {
  book: QuarantineBook;
  queue: SteeringQueue;
  receipts: ReceiptJournal;
  ledger: HoldLedger;
  routes: ActionRoutes;
  logs: string[];
  crash(): void;
};

const roots: string[] = [];
const activeLocks: Array<{ lock: HeldLock; path: string }> = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-receipt-restart-"));
  roots.push(dir);
  return dir;
}

function boot(
  dir: string,
  runId: string,
  _conversationId: string,
  options: {
    disk?: FrozenDisk;
    now?: () => number;
    transport?: Transport;
  } = {},
): Boot {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, "writer.lock");
  const taken = takeLock(lockPath, () => new Date(NOW));
  if (!taken.ok) throw new Error(`could not take the test writer lock: ${JSON.stringify(taken.refusal)}`);
  activeLocks.push({ lock: taken.lock, path: lockPath });
  const claim = { held: taken.lock, lockedOutBy: null };
  const disk = options.disk ?? new FrozenDisk();
  const now = options.now ?? (() => NOW);

  const openedLedger = openHoldLedger(dir, { lock: claim, writeLine: disk.writer("holds") });
  if (openedLedger.kind !== "open") throw new Error(openedLedger.why);
  const openedReceipts = openReceiptJournal(dir, {
    lock: claim,
    now,
    serverInstanceId: runId,
    writeLine: disk.writer("receipts"),
  });
  if (openedReceipts.kind !== "open") throw new Error(openedReceipts.why);

  const book = new QuarantineBook({ now, serverInstanceId: runId, ledger: openedLedger.ledger });
  book.rehydrate();
  const queue = new SteeringQueue({
    now,
    serverInstanceId: runId,
    quarantine: book,
    receipts: openedReceipts.journal,
  });
  const transport: Transport =
    options.transport ??
    ((target) => ({
      ok: true,
      verified: {
        paneId: target.paneId,
        sessionId: target.sessionId,
        panePid: target.panePid ?? PANE_PID,
        claudePid: PANE_PID + 1,
      },
      sent: [
        ["send-keys", "-t", target.paneId, "-l", "--", "fixture text"],
        ["send-keys", "-t", target.paneId, "Enter"],
      ],
    }));
  const send = makeSendCoordinator({
    book,
    sendMessage: transport,
    answerQuestion: () => {
      throw new Error("queued delivery never answers a question");
    },
  });
  const logs: string[] = [];
  const routes = makeActionRoutes({
    serverInstanceId: runId,
    queue,
    send,
    now,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: (line) => logs.push(line),
  } satisfies Partial<ActionDeps>);

  let crashed = false;
  return {
    book,
    queue,
    receipts: openedReceipts.journal,
    ledger: openedLedger.ledger,
    routes,
    logs,
    crash() {
      if (crashed) return;
      crashed = true;
      const index = activeLocks.findIndex((entry) => entry.lock === taken.lock);
      if (index >= 0) activeLocks.splice(index, 1);
      // A handed-in shared claim belongs to neither journal, so their close()
      // does not release it. Releasing only the claim models the dead process;
      // no domain object or folded state is handed to the next boot.
      releaseLock(taken.lock, lockPath);
    },
  };
}

afterEach(() => {
  while (activeLocks.length > 0) {
    const entry = activeLocks.pop();
    if (entry === undefined) continue;
    try {
      releaseLock(entry.lock, entry.path);
    } catch {
      // A test may already have crossed its simulated process boundary.
    }
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

function row(
  sessionId: string,
  paneId: string,
  conversationId: string,
  over: Partial<FleetRow> = {},
): FleetRow {
  return {
    description: { kind: "not-yet-described", why: "a restart fixture" },
    id: sessionId,
    name: "receipt-restart-fixture",
    title: null,
    repo: null,
    worktree: null,
    meta: { version: "legacy" },
    role: { kind: "none" },
    startedAt: "2026-09-10T10:00:00.000Z",
    pause: { kind: "cannot-tell", why: "a restart fixture", cause: "rate-limits-not-collected" },
    execution: { kind: "unknown", cause: "not-probed", why: "a restart fixture" },
    status: { kind: "idle" },
    paneId,
    panePid: PANE_PID,
    claudeSessionId: conversationId,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "a restart fixture" },
    ...over,
  };
}

function snapshot(rows: FleetRow[], generation: number | null = GENERATION): FleetSnapshot {
  return {
    rows,
    collectedAt: "2026-09-10T10:01:00.000Z",
    tookMs: 1,
    tmuxServerPid: generation,
  };
}

type FakeResponse = {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  done: Promise<void>;
};

function fakeResponse(): { res: ServerResponse; seen: FakeResponse } {
  let finish: () => void = () => {};
  const seen: FakeResponse = {
    status: null,
    headers: {},
    body: "",
    done: new Promise<void>((resolve) => {
      finish = resolve;
    }),
  };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      seen.status = status;
      seen.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
      return res;
    },
    end(body?: string) {
      seen.body = body ?? "";
      finish();
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, seen };
}

function fakeRequest(url: string, method: string, body?: unknown): IncomingMessage {
  const stream = new PassThrough();
  if (body !== undefined) stream.write(JSON.stringify(body));
  stream.end();
  return Object.assign(stream, {
    url,
    method,
    headers: {
      host: HOST,
      origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as IncomingMessage;
}

async function request(
  routes: ActionRoutes,
  url: string,
  method: string,
  body?: unknown,
): Promise<FakeResponse & { json: Record<string, unknown> }> {
  const { res, seen } = fakeResponse();
  expect(routes.handle(fakeRequest(url, method, body), res)).toBe(true);
  await seen.done;
  return {
    ...seen,
    json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>),
  };
}

function enqueueBody(conversationId: string, text: string, sessionId = SESSION_A, paneId = PANE_A) {
  return {
    paneId,
    sessionId,
    claudeSessionId: conversationId,
    panePid: PANE_PID,
    status: { kind: "idle" },
    mode: "enqueue",
    speaker: "greg",
    text,
  };
}

async function enqueue(booted: Boot, conversationId: string, text: string, sessionId = SESSION_A, paneId = PANE_A) {
  return request(booted.routes, "/api/actions/session", "POST", enqueueBody(conversationId, text, sessionId, paneId));
}

function receiptForItem(journal: ReceiptJournal, itemId: string) {
  return journal.recent(100).find((state) => state.accepted.queue?.itemId === itemId) ?? null;
}

function materialNames(dir: string): string[] {
  try {
    return readdirSync(join(dir, "material")).filter((name) => name.endsWith(".json") || name.includes(".json.tmp-"));
  } catch {
    return [];
  }
}

describe("queued receipts across a frozen-disk process boundary", () => {
  it("before accepted lands: leaves no receipt or restored item and cleans orphan material", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    disk.arm({ store: "receipts", kind: "accepted", mode: "before" });
    const first = boot(dir, "a101a101", conversationId, { disk });
    await enqueue(first, conversationId, "words whose acceptance never reached disk");
    first.crash();

    const second = boot(dir, "b202b202", conversationId);
    expect(second.receipts.recent(10)).toEqual([]);
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("after accepted and before attempted: restores the original item and delivers it exactly once", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a111a111", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    disk.arm({ store: "receipts", kind: "accepted", mode: "after" });
    const accepted = await enqueue(first, conversationId, "survive this dashboard restart");
    const original = (accepted.json.item as { id: string; enqueuedAt: number }).id;
    expect(accepted.json.durable).toBe(true);
    first.crash();

    const second = boot(dir, "b222b222", conversationId, {
      transport: (target, text) => {
        keys.push({ kind: "text", text }, { kind: "enter" });
        return {
          ok: true,
          verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
          sent: [["send-keys", "-t", target.paneId, "-l", "--", text], ["send-keys", "-t", target.paneId, "Enter"]],
        };
      },
    });
    expect(second.queue.snapshot(SESSION_A).items.map((item) => item.id)).toEqual([original]);
    expect(second.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)])).outcomes).toMatchObject([
      { kind: "delivered", itemId: original },
    ]);
    expect(keys.map((key) => key.kind)).toEqual(["text", "enter"]);
    expect(materialNames(dir)).toEqual([]);
    second.crash();

    const third = boot(dir, "c333c333", conversationId, {
      transport: () => {
        throw new Error("a terminal receipt must never be delivered again");
      },
    });
    expect(third.queue.totalSize()).toBe(0);
    expect(keys).toHaveLength(2);
  });

  it("after attempted and before the coordinator: concludes interrupted and never types", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a121a121", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "do not repeat an interrupted attempt");
    const item = accepted.json.item as { id: string };
    expect(first.queue.next(SESSION_A, { status: { kind: "idle" }, claudeSessionId: conversationId }).kind).toBe("ready");
    disk.arm({ store: "receipts", kind: "attempted", mode: "after" });
    expect(first.queue.beginDelivery(SESSION_A, item.id)).toMatchObject({ ok: true });
    first.crash();

    const second = boot(dir, "b232b232", conversationId);
    const receipt = receiptForItem(second.receipts, item.id);
    expect(receipt?.last).toMatchObject({ kind: "outcome", state: "outcome-unknown", reason: "interrupted" });
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("between literal text and Enter: records only the first key, recovers unknown, and rehydrates the hold", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a131a131", conversationId, {
      disk,
      transport: (target, text) => {
        keys.push({ kind: "text", text });
        disk.freeze();
        return {
          ok: false,
          reason: { code: "send-failed", why: "the process stopped between literal text and Enter" },
          delivery: "partial",
          sent: [["send-keys", "-t", target.paneId, "-l", "--", text]],
        };
      },
    });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "freeze between the two send-keys calls");
    const item = accepted.json.item as { id: string };
    first.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    expect(keys.map((key) => key.kind)).toEqual(["text"]);
    first.crash();

    const second = boot(dir, "b242b242", conversationId);
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({
      state: "outcome-unknown",
      reason: "interrupted",
    });
    expect(second.book.holding(SESSION_A)).not.toBeNull();
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("after the send and before outcome: never sends the ambiguous message again", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "a141a141", conversationId, {
      disk,
      transport: (target, text) => {
        keys.push({ kind: "text", text }, { kind: "enter" });
        // The hold ledger may finish its own account; only the receipt outcome
        // is missing at this crash point.
        disk.freeze("receipts");
        return {
          ok: true,
          verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
          sent: [["send-keys", "-t", target.paneId, "-l", "--", text], ["send-keys", "-t", target.paneId, "Enter"]],
        };
      },
    });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "the outcome line will not land");
    const item = accepted.json.item as { id: string };
    first.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    first.crash();

    const second = boot(dir, "b252b252", conversationId, {
      transport: () => {
        throw new Error("an ambiguous attempted receipt must not be retried");
      },
    });
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    expect(second.queue.totalSize()).toBe(0);
    expect(keys.map((key) => key.kind)).toEqual(["text", "enter"]);
    expect(materialNames(dir)).toEqual([]);
  });

  it("during the outcome line: repairs the torn tail and lets the last whole attempted record decide", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a151a151", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "tear the final outcome record");
    const item = accepted.json.item as { id: string };
    disk.arm({ store: "receipts", kind: "outcome", mode: "torn" });
    first.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    first.crash();

    const second = boot(dir, "b262b262", conversationId);
    expect(second.receipts.status().repaired.torn).toBe(true);
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("after the outcome and before any acknowledgement: keeps the terminal proof", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a161a161", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "freeze only after the proof is complete");
    const item = accepted.json.item as { id: string };
    disk.arm({ store: "receipts", kind: "outcome", mode: "after" });
    first.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    first.crash();

    const second = boot(dir, "b272b272", conversationId);
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({
      state: "keys-submitted",
      reason: "transport-ok",
    });
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("an unreadable complete attempted line blocks only its receipt and is not restored", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a171a171", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const one = await enqueue(first, conversationId, "the attributable unreadable attempt");
    const oneItem = one.json.item as { id: string };
    expect(first.queue.next(SESSION_A, { status: { kind: "idle" }, claudeSessionId: conversationId }).kind).toBe("ready");
    disk.arm({ store: "receipts", kind: "attempted", mode: "unreadable" });
    first.queue.beginDelivery(SESSION_A, oneItem.id);
    const two = await enqueue(first, conversationId, "a later valid accepted record makes that line mid-file");
    const twoItem = two.json.item as { id: string };
    first.crash();

    const second = boot(dir, "b282b282", conversationId);
    expect(receiptForItem(second.receipts, oneItem.id)?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    expect(second.queue.snapshot(SESSION_A).items.map((item) => item.id)).toEqual([twoItem.id]);
    expect(materialNames(dir).some((name) => name.includes(receiptForItem(second.receipts, oneItem.id)?.receiptId ?? "missing"))).toBe(false);
  });

  it("malformed bytes block every restorable receipt rather than guessing which one was attempted", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a181a181", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const one = await enqueue(first, conversationId, "first receipt behind malformed evidence");
    disk.arm({ store: "receipts", kind: "generation", mode: "malformed" });
    first.receipts.noteGeneration(GENERATION + 1);
    const two = await enqueue(first, conversationId, "second receipt behind malformed evidence");
    const ids = [one.json.item, two.json.item].map((item) => (item as { id: string }).id);
    first.crash();

    const second = boot(dir, "b292b292", conversationId);
    expect(second.receipts.recovery().blocked).toBe(true);
    for (const id of ids) {
      expect(receiptForItem(second.receipts, id)?.last).toMatchObject({ state: "outcome-unknown", reason: "recovery-blocked" });
    }
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });

  it("after withdrawn and before the response: stays withdrawn and leaves no material", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "a191a191", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "withdraw this before delivery");
    const item = accepted.json.item as { id: string };
    disk.arm({ store: "receipts", kind: "withdrawn", mode: "after" });
    await request(first.routes, "/api/actions/cancel", "POST", { sessionId: SESSION_A, itemId: item.id });
    first.crash();

    const second = boot(dir, "b303b303", conversationId);
    expect(receiptForItem(second.receipts, item.id)?.last.kind).toBe("withdrawn");
    expect(second.queue.totalSize()).toBe(0);
    expect(materialNames(dir)).toEqual([]);
  });
});

describe("write-ahead cancellation and delivery", () => {
  it("a detected attempted-write failure holds as not-durable, types nothing, and clears the lease", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const keys: Key[] = [];
    const first = boot(dir, "c101c101", conversationId, {
      disk,
      transport: (_target, text) => {
        keys.push({ kind: "text", text }, { kind: "enter" });
        throw new Error("the transport must not be reached");
      },
    });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "wait until attempted is durable");
    const item = accepted.json.item as { id: string };
    disk.arm({ store: "receipts", kind: "attempted", mode: "throw" });

    const result = first.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    expect(result.outcomes).toMatchObject([{ kind: "held", itemId: item.id, reason: "not-durable" }]);
    expect(keys).toEqual([]);
    expect(first.queue.snapshot(SESSION_A).items).toMatchObject([{ id: item.id, leasedAt: null }]);
    expect(first.receipts.get(receiptForItem(first.receipts, item.id)?.receiptId ?? "")?.last.kind).toBe("accepted");
  });

  it("a cancel answered 200 stays cancelled after restart", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "c111c111", conversationId);
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "cancel durably");
    const item = accepted.json.item as { id: string };
    const cancelled = await request(first.routes, "/api/actions/cancel", "POST", { sessionId: SESSION_A, itemId: item.id });
    expect(cancelled.status).toBe(200);
    first.crash();

    const second = boot(dir, "d222d222", conversationId);
    expect(second.queue.totalSize()).toBe(0);
    expect(receiptForItem(second.receipts, item.id)?.last.kind).toBe("withdrawn");
  });

  it("a withdrawal which cannot land returns 503 and changes nothing", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const disk = new FrozenDisk();
    const first = boot(dir, "c121c121", conversationId, { disk });
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "do not pretend this cancellation landed");
    const item = accepted.json.item as { id: string };
    disk.arm({ store: "receipts", kind: "withdrawn", mode: "throw" });

    const cancelled = await request(first.routes, "/api/actions/cancel", "POST", { sessionId: SESSION_A, itemId: item.id });
    expect(cancelled.status).toBe(503);
    expect(String(cancelled.json.why)).toMatch(/receipt|durable|written/i);
    expect(first.queue.snapshot(SESSION_A).items.map((queued) => queued.id)).toEqual([item.id]);
  });

  it("clear writes one record naming every removed receipt", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "c131c131", conversationId);
    first.queue.noteGeneration(GENERATION);
    const one = await enqueue(first, conversationId, "clear the first durable item");
    const two = await enqueue(first, conversationId, "clear the second durable item");
    const itemIds = [one.json.item, two.json.item].map((item) => (item as { id: string }).id);
    const cleared = await request(first.routes, "/api/actions/clear", "POST", { sessionId: SESSION_A, itemIds });
    expect(cleared.status).toBe(200);

    const records = readFileSync(join(dir, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; receiptIds?: string[] });
    const withdrawn = records.filter((record) => record.kind === "withdrawn");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]?.receiptIds).toEqual(itemIds.map((id) => receiptForItem(first.receipts, id)?.receiptId));
  });

  it("an old page can cancel a restored item under its original foreign-run id", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "c141c141", conversationId);
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "the old page still owns this id");
    const item = accepted.json.item as { id: string };
    first.crash();

    const second = boot(dir, "d252d252", conversationId);
    expect(second.queue.idOrigin(item.id)).toBe("other-instance");
    expect(second.queue.snapshot(SESSION_A).items.map((queued) => queued.id)).toEqual([item.id]);
    const cancelled = await request(second.routes, "/api/actions/cancel", "POST", { sessionId: SESSION_A, itemId: item.id });
    expect(cancelled.status).toBe(200);
    second.crash();

    const third = boot(dir, "e363e363", conversationId);
    expect(third.queue.totalSize()).toBe(0);
  });

  it("refuses an entire clear when an old-page list mixes one restored id with one stale foreign id", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "c151c151", conversationId);
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "keep this restored item when the old list is mixed");
    const item = accepted.json.item as { id: string };
    first.crash();

    const second = boot(dir, "d262d262", conversationId);
    const cleared = await request(second.routes, "/api/actions/clear", "POST", {
      sessionId: SESSION_A,
      itemIds: [item.id, "c151c151-q999"],
    });

    expect(cleared.status).toBe(409);
    expect(cleared.json.code).toBe("other-instance");
    expect(second.queue.snapshot(SESSION_A).items.map((queued) => queued.id)).toEqual([item.id]);
    expect(receiptForItem(second.receipts, item.id)?.last.kind).toBe("accepted");
  });
});

describe("restoration guards and pinned payloads", () => {
  it("waits through a null-generation drain pass before judging a restored item against the first real generation", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const keys: Key[] = [];
    const first = boot(dir, "e091e091", conversationId);
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "wait for a real tmux generation");
    const item = accepted.json.item as { id: string };
    first.crash();

    const second = boot(dir, "f190f190", conversationId, {
      transport: (target, text) => {
        keys.push({ kind: "text", text }, { kind: "enter" });
        return {
          ok: true,
          verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
          sent: [["send-keys", "-t", target.paneId, "-l", "--", text], ["send-keys", "-t", target.paneId, "Enter"]],
        };
      },
    });
    const unknown = second.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)], null));
    expect(unknown.outcomes).toMatchObject([{ kind: "held", reason: "no-generation" }]);
    expect(second.queue.snapshot(SESSION_A).items.map((queued) => queued.id)).toEqual([item.id]);
    expect(keys).toEqual([]);

    const proven = second.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    expect(proven.outcomes).toMatchObject([{ kind: "delivered", itemId: item.id }]);
    expect(keys.map((key) => key.kind)).toEqual(["text", "enter"]);
  });

  it("concludes a restored item when the tmux generation changed", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "e101e101", conversationId);
    first.queue.noteGeneration(GENERATION);
    const accepted = await enqueue(first, conversationId, "belongs to the old tmux server");
    const item = accepted.json.item as { id: string };
    first.crash();

    const second = boot(dir, "f202f202", conversationId);
    expect(second.queue.snapshot(SESSION_A).items).toHaveLength(1);
    expect(second.queue.noteGeneration(GENERATION + 1)).toBe(1);
    expect(second.queue.totalSize()).toBe(0);
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({
      state: "not-sent",
      reason: "tmux-generation-changed",
    });
    expect(materialNames(dir)).toEqual([]);
  });

  it("concludes a restored item whose accepted generation was null", async () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "e111e111", conversationId);
    const accepted = await enqueue(first, conversationId, "no tmux generation was proven");
    const item = accepted.json.item as { id: string };
    first.crash();

    const second = boot(dir, "f212f212", conversationId);
    expect(second.queue.snapshot(SESSION_A).items).toHaveLength(1);
    expect(second.queue.noteGeneration(GENERATION)).toBe(1);
    expect(second.queue.totalSize()).toBe(0);
    expect(receiptForItem(second.receipts, item.id)?.last).toMatchObject({
      state: "not-sent",
      reason: "tmux-generation-unproven",
    });
    expect(materialNames(dir)).toEqual([]);
  });

  it("restores and sends the pinned SpokenAction snapshot, not today's catalogue text", () => {
    const dir = root();
    const conversationId = randomUUID();
    const first = boot(dir, "e121e121", conversationId);
    first.queue.noteGeneration(GENERATION);
    const current = actionById("continue");
    if (current?.effect !== "spoken") throw new Error("the fixture action is no longer spoken");
    const pinned: SpokenAction = { ...current, text: "These are the exact accepted words from the old catalogue." };
    const accepted = first.receipts.accept({
      requestId: null,
      fingerprint: null,
      op: "queued-action",
      origin: "enqueue",
      actor: { kind: "client-claimed", id: "greg" },
      speaker: "greg",
      target: { sessionId: SESSION_A, paneId: null, claudeSessionId: conversationId, tmuxGeneration: GENERATION },
      what: `action ${pinned.id}`,
      queue: { itemId: "e121e121-q41", enqueuedAt: NOW - 10 },
      material: { kind: "action", action: pinned, speaker: "greg" },
    });
    expect(accepted.ok).toBe(true);
    first.crash();

    const sent: string[] = [];
    const second = boot(dir, "f222f222", conversationId, {
      transport: (target, text) => {
        sent.push(text);
        return {
          ok: true,
          verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
          sent: [["send-keys", "-t", target.paneId, "-l", "--", text], ["send-keys", "-t", target.paneId, "Enter"]],
        };
      },
    });
    second.routes.drain(snapshot([row(SESSION_A, PANE_A, conversationId)]));
    expect(sent).toEqual([`${GREG_PREFIX}${pinned.text}`]);
    expect(sent[0]).not.toContain(current.text);
  });
});

describe("GET /api/actions/receipts", () => {
  it("shows recovery conclusions and computes unknown-without-hold once at startup", async () => {
    const dir = root();
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const first = boot(dir, "g101g101", conversationA);
    first.queue.noteGeneration(GENERATION);
    const a = await enqueue(first, conversationA, "unknown with a durable hold attempt", SESSION_A, PANE_A);
    const b = await enqueue(first, conversationB, "unknown without a hold attempt", SESSION_B, PANE_B);
    const aItem = (a.json.item as { id: string }).id;
    const bItem = (b.json.item as { id: string }).id;
    expect(first.queue.next(SESSION_A, { status: { kind: "idle" }, claudeSessionId: conversationA }).kind).toBe("ready");
    expect(first.queue.beginDelivery(SESSION_A, aItem)).toMatchObject({ ok: true });
    expect(first.queue.next(SESSION_B, { status: { kind: "idle" }, claudeSessionId: conversationB }).kind).toBe("ready");
    expect(first.queue.beginDelivery(SESSION_B, bItem)).toMatchObject({ ok: true });
    first.ledger.noteAttempt({
      at: NOW,
      sessionId: SESSION_A,
      paneId: PANE_A,
      claudeSessionId: conversationA,
      origin: "queued-delivery",
      what: "message (35 characters)",
      serverInstanceId: "g101g101",
      tmuxGeneration: GENERATION,
    });
    first.crash();

    const second = boot(dir, "h202h202", conversationA);
    const beforeLogs = [...second.logs];
    const response = await request(second.routes, "/api/actions/receipts", "GET");
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      op: "receipts",
      schema: 1,
      durable: true,
      unknownWithoutHold: [{ sessionId: SESSION_B, receiptIds: [receiptForItem(second.receipts, bItem)?.receiptId] }],
    });
    expect(response.json.recovery).toMatchObject({ interrupted: expect.arrayContaining([
      receiptForItem(second.receipts, aItem)?.receiptId,
      receiptForItem(second.receipts, bItem)?.receiptId,
    ]) });
    expect(response.json.nonTerminal).toEqual([]);
    expect(JSON.stringify(response.json)).not.toContain("unknown with a durable hold attempt");
    expect(JSON.stringify(response.json)).not.toContain("unknown without a hold attempt");
    expect(second.logs).toEqual(beforeLogs);

    const head = await request(second.routes, "/api/actions/receipts", "HEAD");
    expect(head.status).toBe(200);
    expect(second.logs).toEqual(beforeLogs);
    const wrongMethod = await request(second.routes, "/api/actions/receipts", "POST", {});
    expect(wrongMethod.status).toBe(405);
  });
});
