/**
 * Plan 260910d Stage 3: receipts for a broadcast — one parent per request,
 * a child per recipient.
 *
 * **NOTHING HERE TOUCHES TMUX.** The transport is a recorder below the real
 * send coordinator. A crash is a disk that stops accepting bytes
 * (`FrozenDisk`), and a restart is a fresh composition over the same
 * directory, so the only thing that crosses the boundary is bytes on disk.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { openReceiptJournal, type ReceiptJournal, type ReceiptState } from "../tools/fleet/receipt-journal.js";
import { makeActionRoutes, type ActionIo, type ActionRoutes } from "../tools/fleet/routes-actions.js";
import { BROADCAST_DEADLINE_MS, makeBroadcastRoutes, type BroadcastRoutes } from "../tools/fleet/routes-broadcast.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { FrozenDisk } from "./helpers/fleet-frozen-disk.js";

const CONVERSATION = "eaa033ee-51fd-46fb-9e68-dc23bb7167f0";
const NOW = 1_800_300_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const TEXT = "hold off on the heavy suites for a while";
const IDLE: FleetStatus = { kind: "idle" };
const WORKING: FleetStatus = { kind: "working" };
const SHELL: FleetStatus = { kind: "shell", busy: false };

function requestId(tag: string): string {
  return `rq-${NOW.toString(36)}-${tag.padEnd(16, "0")}`;
}

function recipient(n: number, status: FleetStatus = IDLE) {
  return { sessionId: `$988${n}0`, paneId: `%988${n}0`, claudeSessionId: CONVERSATION, panePid: 98_800 + n, status };
}

type Transport = (target: SteerTarget, text: string) => SteerResult;

const OK = (target: SteerTarget): SteerResult => ({
  ok: true,
  verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: target.panePid ?? 1, claudePid: 2 },
  sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"], ["send-keys", "-t", target.paneId, "Enter"]],
});

type Boot = {
  receipts: ReceiptJournal;
  queue: SteeringQueue;
  actions: ActionRoutes;
  broadcast: BroadcastRoutes;
  calls: string[];
  tick(ms: number): void;
  crash(): void;
};

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-broadcast-receipts-"));
  roots.push(dir);
  return dir;
}

const INERT_IO = {
  runStep: () => Promise.reject(new Error("a broadcast never runs a step")),
  listProcesses: () => Promise.reject(new Error("a broadcast never scans the box")),
  selfPid: () => 999_999,
  readProcessStart: () => ({ read: false as const, why: "not in this test" }),
  readBootIdentity: () => ({ read: false as const, cause: "boot-identity-unreadable" as const, why: "not in this test" }),
} as unknown as ActionIo;

function boot(dir: string, runId: string, options: { disk?: FrozenDisk; transport?: (target: SteerTarget, text: string, boot: { tick(ms: number): void }) => SteerResult } = {}): Boot {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, "writer.lock");
  const taken = takeLock(lockPath, () => new Date(NOW));
  if (!taken.ok) throw new Error(`could not take the test writer lock: ${JSON.stringify(taken.refusal)}`);
  locks.push({ lock: taken.lock, path: lockPath });
  const disk = options.disk ?? new FrozenDisk();
  let clock = NOW;
  const now = (): number => clock;
  const tick = (ms: number): void => {
    clock += ms;
  };
  const opened = openReceiptJournal(dir, {
    lock: { held: taken.lock, lockedOutBy: null },
    now,
    serverInstanceId: runId,
    writeLine: disk.writer("receipts"),
  });
  if (opened.kind !== "open") throw new Error(opened.why);
  const calls: string[] = [];
  const transport: Transport = (target, text) => {
    // A dead process types nothing.
    if (disk.isFrozen()) return OK(target);
    calls.push(target.sessionId);
    return options.transport === undefined ? OK(target) : options.transport(target, text, { tick });
  };
  const book = new QuarantineBook({ now, serverInstanceId: runId });
  const send = makeSendCoordinator({
    book,
    sendMessage: transport,
    answerQuestion: () => {
      throw new Error("a broadcast never answers a dialog");
    },
  });
  const queue = new SteeringQueue({ now, serverInstanceId: runId, quarantine: book, receipts: opened.journal });
  const actions = makeActionRoutes({
    serverInstanceId: runId,
    queue,
    send,
    io: INERT_IO,
    now,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
    actEnabled: () => true,
    primaryDir: () => "/nonexistent/fixture-broadcast-checkout",
    yieldToLoop: () => Promise.resolve(),
  });
  const broadcast = makeBroadcastRoutes({
    send,
    receipts: opened.journal,
    now,
    log: () => {},
    runEnabled: () => true,
    yieldToLoop: () => Promise.resolve(),
    enqueue: (target, text, speaker, parentReceiptId) => {
      const result = actions.enqueueMessage(target, text, speaker, parentReceiptId);
      return result.ok
        ? { ok: true, position: result.position, durable: result.durable, receiptId: result.receiptId }
        : { ok: false, rule: result.rule, why: result.why };
    },
  });
  let crashed = false;
  return {
    receipts: opened.journal,
    queue,
    actions,
    broadcast,
    calls,
    tick,
    crash() {
      if (crashed) return;
      crashed = true;
      const index = locks.findIndex((entry) => entry.lock === taken.lock);
      if (index >= 0) locks.splice(index, 1);
      releaseLock(taken.lock, lockPath);
    },
  };
}

afterEach(() => {
  while (locks.length > 0) {
    const entry = locks.pop();
    if (entry === undefined) continue;
    try {
      releaseLock(entry.lock, entry.path);
    } catch {
      // Already released by a simulated crash.
    }
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

type Res = { status: number | null; json: Record<string, unknown> };

async function post(routes: { handle(req: IncomingMessage, res: ServerResponse): boolean }, url: string, body: unknown): Promise<Res> {
  const stream = new PassThrough();
  stream.write(JSON.stringify(body));
  stream.end();
  const req = Object.assign(stream, {
    url,
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

function broadcastBody(recipients: ReturnType<typeof recipient>[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: TEXT, speaker: "greg", mode: "run", confirm: true, recipients, ...over };
}

function parentOf(journal: ReceiptJournal): ReceiptState {
  const found = journal.recent(50).filter((state) => state.accepted.op === "broadcast");
  expect(found).toHaveLength(1);
  const parent = found[0];
  if (parent === undefined) throw new Error("no broadcast receipt");
  return parent;
}

function childFor(journal: ReceiptJournal, parent: ReceiptState, sessionId: string): ReceiptState | undefined {
  return journal.childrenOf(parent.receiptId).find((state) => state.accepted.target?.sessionId === sessionId);
}

const kinds = (state: ReceiptState | null | undefined): string[] => (state?.records ?? []).map((record) => record.kind);

type Row = { sessionId: string; kind: string; durable?: boolean };
const rowFor = (json: Record<string, unknown>, sessionId: string): Row | undefined =>
  ((json.result as { recipients: Row[] } | undefined)?.recipients ?? []).find((row) => row.sessionId === sessionId);

describe("POST /api/broadcast writes a parent and a child per recipient", () => {
  it("accepts and attempts the parent before the first send, and each child before its own", async () => {
    const seenAtSend: Record<string, { parent: string[]; child: string[] }> = {};
    let journal: ReceiptJournal | null = null;
    const first = boot(root(), "b1c1b1c1", {
      transport: (target) => {
        if (journal !== null) {
          const parent = parentOf(journal);
          seenAtSend[target.sessionId] = { parent: kinds(parent), child: kinds(childFor(journal, parent, target.sessionId)) };
        }
        return OK(target);
      },
    });
    journal = first.receipts;
    const r = await post(
      first.broadcast,
      "/api/broadcast",
      broadcastBody([recipient(1), recipient(2), recipient(3, WORKING)], { requestId: requestId("broadcastone") }),
    );
    expect(r.status).toBe(200);
    const parent = parentOf(first.receipts);
    expect(r.json.receiptId).toBe(parent.receiptId);
    expect(parent.accepted).toMatchObject({ target: null, parentReceiptId: null, origin: "broadcast", requestId: requestId("broadcastone") });
    expect(seenAtSend["$98810"]).toEqual({ parent: ["accepted", "attempted"], child: ["accepted", "attempted"] });
    expect(seenAtSend["$98820"]?.child).toEqual(["accepted", "attempted"]);

    const children = first.receipts.childrenOf(parent.receiptId);
    expect(children.map((child) => child.accepted.op).sort()).toEqual(["broadcast-recipient", "broadcast-recipient", "queued-message"]);
    for (const child of children) expect(child.accepted.parentReceiptId).toBe(parent.receiptId);
    expect(childFor(first.receipts, parent, "$98810")?.last).toMatchObject({ kind: "outcome", state: "keys-submitted" });
    expect(childFor(first.receipts, parent, "$98830")).toMatchObject({ last: { kind: "accepted" } });
    expect(rowFor(r.json, "$98830")).toMatchObject({ kind: "queued", durable: true });
    expect(parent.last).toMatchObject({ kind: "outcome", state: "completed", reason: "fan-out-finished" });
    const why = parent.last.kind === "outcome" ? parent.last.why : "";
    expect(why).toContain("keys-submitted 2");
    expect(why).toContain("queued 1");
    expect(JSON.stringify(first.receipts.recent(50))).not.toContain(TEXT);
  });

  it("gives a recipient the deadline cut off a not-sent/not-reached child that was never attempted", async () => {
    const first = boot(root(), "b2c2b2c2", {
      transport: (target, _text, clock) => {
        clock.tick(BROADCAST_DEADLINE_MS + 1);
        return OK(target);
      },
    });
    const r = await post(first.broadcast, "/api/broadcast", broadcastBody([recipient(1), recipient(2)]));
    expect(r.status).toBe(200);
    expect(rowFor(r.json, "$98820")?.kind).toBe("not-reached");
    const parent = parentOf(first.receipts);
    const cut = childFor(first.receipts, parent, "$98820");
    expect(kinds(cut)).toEqual(["accepted", "outcome"]);
    expect(cut?.last).toMatchObject({ state: "not-sent", reason: "not-reached" });
    expect(first.calls).toEqual(["$98810"]);
  });

  it("F36: a queued recipient whose receipt is not durable is reported as not durable", async () => {
    const disk = new FrozenDisk();
    const first = boot(root(), "b3c3b3c3", { disk });
    // r1 is the parent, r2 the first queued child: its accepted line fails, so it lives in memory only.
    disk.arm({ store: "receipts", kind: "accepted", receiptId: "b3c3b3c3-r2", mode: "throw" });
    const r = await post(first.broadcast, "/api/broadcast", broadcastBody([recipient(1, WORKING), recipient(2, WORKING)]));
    expect(r.status).toBe(200);
    expect(rowFor(r.json, "$98810")).toMatchObject({ kind: "queued", durable: false });
    expect(rowFor(r.json, "$98820")).toMatchObject({ kind: "queued", durable: true });
    const parent = parentOf(first.receipts);
    expect(parent.last).toMatchObject({ kind: "outcome", state: "outcome-unknown" });
    expect(parent.last.kind === "outcome" ? parent.last.why : "").toContain("1 not durable");
  });

  it("does not complete the parent over an outcome-unknown child", async () => {
    const first = boot(root(), "b3d3b3d3", {
      transport: (target) => ({
        ok: false,
        reason: { code: "send-partial", why: "the text went and Enter did not" },
        delivery: "partial",
        sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"]],
      }),
    });
    const r = await post(first.broadcast, "/api/broadcast", broadcastBody([recipient(1)]));
    expect(r.status).toBe(200);
    const parent = parentOf(first.receipts);
    expect(childFor(first.receipts, parent, "$98810")?.last).toMatchObject({ state: "outcome-unknown" });
    expect(parent.last).toMatchObject({ kind: "outcome", state: "outcome-unknown" });
  });

  it("does not let a later parent write mask a child outcome that failed to reach disk", async () => {
    const dir = root();
    const disk = new FrozenDisk();
    const first = boot(dir, "b3f3b3f3", { disk });
    disk.arm({ store: "receipts", kind: "outcome", receiptId: "b3f3b3f3-r2", mode: "throw" });
    const body = broadcastBody([recipient(1)], { requestId: requestId("childoutcomegap") });
    const once = await post(first.broadcast, "/api/broadcast", body);
    expect(once.status).toBe(200);
    expect(parentOf(first.receipts).last).toMatchObject({ state: "outcome-unknown" });
    first.crash();

    const second = boot(dir, "b3g3b3g3");
    const parent = parentOf(second.receipts);
    expect(parent.last).toMatchObject({ state: "outcome-unknown" });
    expect(childFor(second.receipts, parent, "$98810")?.last).toMatchObject({ state: "outcome-unknown" });
    const replay = await post(second.broadcast, "/api/broadcast", body);
    expect(replay.json).toMatchObject({ op: "receipt", replay: true, receipt: { state: "outcome-unknown" } });
    expect(second.calls).toEqual([]);
  });

  it("gives a skipped recipient a linked not-sent child", async () => {
    const first = boot(root(), "b3e3b3e3");
    const r = await post(first.broadcast, "/api/broadcast", broadcastBody([recipient(1), recipient(2, SHELL)]));
    expect(r.status).toBe(200);
    const parent = parentOf(first.receipts);
    expect(first.receipts.childrenOf(parent.receiptId)).toHaveLength(2);
    expect(childFor(first.receipts, parent, "$98820")?.last).toMatchObject({
      kind: "outcome",
      state: "not-sent",
      reason: "undeliverable",
    });
  });

  it("a keyed broadcast whose parent cannot be accepted is refused 503, does nothing, and keeps the cooldown free", async () => {
    const disk = new FrozenDisk();
    const first = boot(root(), "b4c4b4c4", { disk });
    disk.arm({ store: "receipts", kind: "accepted", mode: "throw" });
    const r = await post(
      first.broadcast,
      "/api/broadcast",
      broadcastBody([recipient(1), recipient(2, WORKING)], { requestId: requestId("broadcastnoaccept") }),
    );
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("receipt-unavailable");
    expect(first.calls).toEqual([]);
    expect(first.queue.totalSize()).toBe(0);
    const next = await post(first.broadcast, "/api/broadcast", broadcastBody([recipient(1)]));
    expect(next.status).toBe(200);
  });
});

describe("a broadcast across a frozen-disk restart", () => {
  it("a crash mid fan-out recovers the parent as unknown and sends to nobody again", async () => {
    const dir = root();
    const disk = new FrozenDisk();
    let sends = 0;
    const first = boot(dir, "b5c5b5c5", {
      disk,
      transport: (target) => {
        sends += 1;
        if (sends === 2) disk.freeze();
        return OK(target);
      },
    });
    const body = broadcastBody([recipient(1), recipient(2), recipient(3)], { requestId: requestId("broadcastcrash") });
    await post(first.broadcast, "/api/broadcast", body);
    expect(first.calls).toEqual(["$98810", "$98820"]);
    first.crash();

    const second = boot(dir, "b6c6b6c6", {
      transport: () => {
        throw new Error("no recipient of an interrupted broadcast is sent to again");
      },
    });
    const parent = parentOf(second.receipts);
    expect(parent.last).toMatchObject({ kind: "outcome", state: "outcome-unknown", reason: "interrupted" });
    expect(childFor(second.receipts, parent, "$98810")?.last).toMatchObject({ state: "keys-submitted" });
    expect(childFor(second.receipts, parent, "$98820")?.last).toMatchObject({ state: "outcome-unknown", reason: "interrupted" });
    expect(childFor(second.receipts, parent, "$98830")).toBeUndefined();
    expect(second.queue.totalSize()).toBe(0);

    const again = await post(second.broadcast, "/api/broadcast", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, op: "receipt", replay: true, receipt: { receiptId: parent.receiptId, state: "outcome-unknown" } });
    expect(again.json.children).toHaveLength(2);
    expect(second.calls).toEqual([]);
  });

  it("a completed broadcast replayed after a restart sends nothing and returns the parent and its children", async () => {
    const dir = root();
    const first = boot(dir, "b7c7b7c7");
    const body = broadcastBody([recipient(1), recipient(2), recipient(3, WORKING)], { requestId: requestId("broadcastreplay") });
    const once = await post(first.broadcast, "/api/broadcast", body);
    expect(once.status).toBe(200);
    first.crash();

    const second = boot(dir, "b8c8b8c8");
    const restored = second.queue.totalSize();
    const again = await post(second.broadcast, "/api/broadcast", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({
      ok: true,
      op: "receipt",
      replay: true,
      receipt: { receiptId: once.json.receiptId, state: "completed", target: null, parentReceiptId: null },
    });
    const children = again.json.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(3);
    for (const child of children) expect(child.parentReceiptId).toBe(once.json.receiptId);
    expect(second.calls).toEqual([]);
    expect(second.queue.totalSize()).toBe(restored);
    expect(JSON.stringify(again.json)).not.toContain(TEXT);
  });
});

describe("the ease-off broadcast on /api/actions/box", () => {
  it("writes a parent and a child per recipient, and a replay after a restart sends nothing", async () => {
    const dir = root();
    const first = boot(dir, "b9c9b9c9");
    const shown = await post(first.actions, "/api/actions/box", {
      actionId: "resource-broadcast",
      mode: "dry-run",
      speaker: "greg",
      recipients: [recipient(1), recipient(2, WORKING)],
    });
    expect(shown.status).toBe(200);
    const preview = shown.json.preview as { previewId: string; serverInstanceId: string; actionId: string; material: unknown };
    const body = {
      actionId: "resource-broadcast",
      mode: "run",
      confirm: true,
      preview: { previewId: preview.previewId, serverInstanceId: preview.serverInstanceId, actionId: preview.actionId },
      material: preview.material,
      requestId: requestId("easeoffreplay"),
    };
    const once = await post(first.actions, "/api/actions/box", body);
    expect(once.status).toBe(200);
    const parent = parentOf(first.receipts);
    expect(once.json.receiptId).toBe(parent.receiptId);
    expect(parent.accepted.target).toBeNull();
    expect(parent.last).toMatchObject({ kind: "outcome", state: "completed", reason: "fan-out-finished" });
    const children = first.receipts.childrenOf(parent.receiptId);
    expect(children).toHaveLength(2);
    expect(childFor(first.receipts, parent, "$98810")?.last).toMatchObject({ kind: "outcome", state: "keys-submitted" });
    expect(childFor(first.receipts, parent, "$98820")?.last).toMatchObject({ kind: "outcome", state: "not-sent" });
    expect(first.calls).toEqual(["$98810"]);
    first.crash();

    const second = boot(dir, "bac0bac0");
    const again = await post(second.actions, "/api/actions/box", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ op: "receipt", replay: true, receipt: { receiptId: parent.receiptId, state: "completed" } });
    expect(again.json.children).toHaveLength(2);
    expect(second.calls).toEqual([]);
  });
});
