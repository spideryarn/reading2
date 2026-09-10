/**
 * Plan 260910d Stage 3: two guarantees a mutation run found no test for.
 *
 *  1. A check that refuses AFTER the one-way door settles the receipt it
 *     accepted — `not-sent`/`refused-before-attempt` — rather than leaving it
 *     at `accepted`, where a replay would report the action still pending.
 *     (`refuseAfterDoor` in routes-actions.ts.) Driven through the kill route's
 *     `box-unreadable` refusal: the broadcast route's own after-the-door
 *     refusals are not reachable through the route, because a run must echo a
 *     stored preview and a stored preview always has somebody at a prompt.
 *  2. A broadcast marks its parent `attempted` BEFORE the queued half, so a
 *     parent whose `attempted` cannot land has queued nothing.
 *
 * Written by the Stages 2–3 mutation run's agent; each test was seen red under
 * its mutation (15 and 16 of 260910d-durable-action-receipts-stage2-3-mutation-task.md)
 * and green once reverted.
 *
 * **NOTHING HERE TOUCHES TMUX OR SIGNALS A PROCESS.** The transport and the
 * process scan are recorders; a write failure is a `FrozenDisk` rule.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import type { ProcRecord } from "../tools/fleet/actions.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { openReceiptJournal, type ReceiptJournal, type ReceiptState } from "../tools/fleet/receipt-journal.js";
import { makeActionRoutes, type ActionIo, type ActionRoutes, type ProcScan, type StepRun } from "../tools/fleet/routes-actions.js";
import { makeBroadcastRoutes, type BroadcastRoutes } from "../tools/fleet/routes-broadcast.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { FrozenDisk } from "./helpers/fleet-frozen-disk.js";

const CONVERSATION = "cfa3dac4-bec9-459c-b29f-7ebe65789060";
const NOW = 1_800_400_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const PRIMARY = "/nonexistent/fixture-stage3-guards-checkout";
const VITEST_ARGS = `${PRIMARY}/node_modules/.bin/vitest run`;
const TEXT = "pause the heavy suites for ten minutes";
const WORKING: FleetStatus = { kind: "working" };
const OK_STEP: StepRun = { code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null };

function requestId(tag: string): string {
  return `rq-${NOW.toString(36)}-${tag.padEnd(16, "0")}`;
}

function proc(over: Partial<ProcRecord>): ProcRecord {
  return { pid: 7000, ppid: 4000, comm: "node", args: "node index.js", cwd: "/home/greg", rssKiB: 1000, etimeSeconds: 60, ...over };
}
const SUITES = [
  proc({ pid: 7001, comm: "node-MainThread", args: VITEST_ARGS }),
  proc({ pid: 7002, comm: "node-MainThread", args: VITEST_ARGS }),
];

/** The box, as a recorder: the scan answers until `failScans` is set. */
type Box = { io: ActionIo; ran: string[][]; failScans: boolean };

function fakeBox(): Box {
  const box: Box = { io: undefined as unknown as ActionIo, ran: [], failScans: false };
  box.io = {
    runStep: (step: { argv: readonly string[] }) => {
      box.ran.push([...step.argv]);
      return Promise.resolve(OK_STEP);
    },
    listProcesses: (): Promise<ProcScan> =>
      Promise.resolve(box.failScans ? { ok: false, why: "ps could not be read (fixture)" } : { ok: true, procs: [...SUITES], unreadable: 0 }),
    selfPid: () => 999_999,
    readProcessStart: (pid: number) => ({ read: true as const, ticks: pid * 100 }),
    readBootIdentity: () => ({ read: true as const, id: "fixture-boot" }),
  } as unknown as ActionIo;
  return box;
}

type Boot = {
  receipts: ReceiptJournal;
  queue: SteeringQueue;
  actions: ActionRoutes;
  broadcast: BroadcastRoutes;
  box: Box;
  calls: string[];
};

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];

function boot(runId: string, disk: FrozenDisk = new FrozenDisk()): Boot {
  const dir = mkdtempSync(join(tmpdir(), "fleet-stage3-guards-"));
  roots.push(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, "writer.lock");
  const taken = takeLock(lockPath, () => new Date(NOW));
  if (!taken.ok) throw new Error(`could not take the test writer lock: ${JSON.stringify(taken.refusal)}`);
  locks.push({ lock: taken.lock, path: lockPath });
  const now = (): number => NOW;
  const opened = openReceiptJournal(dir, {
    lock: { held: taken.lock, lockedOutBy: null },
    now,
    serverInstanceId: runId,
    writeLine: disk.writer("receipts"),
  });
  if (opened.kind !== "open") throw new Error(opened.why);
  const calls: string[] = [];
  const book = new QuarantineBook({ now, serverInstanceId: runId });
  const send = makeSendCoordinator({
    book,
    sendMessage: (target: SteerTarget): SteerResult => {
      calls.push(target.sessionId);
      return {
        ok: true,
        verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: target.panePid ?? 1, claudePid: 2 },
        sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"], ["send-keys", "-t", target.paneId, "Enter"]],
      };
    },
    answerQuestion: () => {
      throw new Error("nothing here answers a dialog");
    },
  });
  const queue = new SteeringQueue({ now, serverInstanceId: runId, quarantine: book, receipts: opened.journal });
  const box = fakeBox();
  const actions = makeActionRoutes({
    serverInstanceId: runId,
    queue,
    send,
    io: box.io,
    now,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
    actEnabled: () => true,
    primaryDir: () => PRIMARY,
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
  return { receipts: opened.journal, queue, actions, broadcast, box, calls };
}

afterEach(() => {
  while (locks.length > 0) {
    const entry = locks.pop();
    if (entry !== undefined) releaseLock(entry.lock, entry.path);
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

function onlyOp(journal: ReceiptJournal, op: string): ReceiptState {
  const found = journal.recent(50).filter((state) => state.accepted.op === op);
  expect(found).toHaveLength(1);
  const state = found[0];
  if (state === undefined) throw new Error(`no ${op} receipt`);
  return state;
}

describe("a refusal after the one-way door settles the receipt it accepted", () => {
  it("a keyed kill whose confirm-time scan fails is not-sent/refused-before-attempt, and its replay is not pending", async () => {
    const w = boot("c7a1c7a1");
    const shown = await post(w.actions, "/api/actions/box", { actionId: "kill-test-suites", mode: "dry-run" });
    expect(shown.status).toBe(200);
    const preview = shown.json.preview as { previewId: string; serverInstanceId: string; actionId: string; material: unknown };
    const body = {
      actionId: "kill-test-suites",
      mode: "run",
      confirm: true,
      preview: { previewId: preview.previewId, serverInstanceId: preview.serverInstanceId, actionId: preview.actionId },
      material: preview.material,
      requestId: requestId("stagethreedoor"),
    };

    w.box.failScans = true;
    const refused = await post(w.actions, "/api/actions/box", body);
    expect(refused.json).toMatchObject({ ok: false, code: "box-unreadable" });
    expect(typeof refused.json.receiptId).toBe("string");
    const receipt = w.receipts.get(String(refused.json.receiptId));
    expect(receipt?.accepted.op).toBe("enacted-box");
    expect(receipt?.last).toMatchObject({ kind: "outcome", state: "not-sent", reason: "refused-before-attempt", code: "box-unreadable" });

    const again = await post(w.actions, "/api/actions/box", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({
      ok: true,
      op: "receipt",
      replay: true,
      receipt: { receiptId: refused.json.receiptId, state: "not-sent", pending: false },
    });
    expect(w.box.ran).toEqual([]);
  });
});

describe("a broadcast is attempted before its queued half", () => {
  it("a parent whose attempted cannot land answers 503 and has queued nothing and made no child", async () => {
    const disk = new FrozenDisk();
    const w = boot("c7b2c7b2", disk);
    disk.arm({ store: "receipts", kind: "attempted", mode: "throw" });
    const r = await post(w.broadcast, "/api/broadcast", {
      text: TEXT,
      speaker: "greg",
      mode: "run",
      confirm: true,
      recipients: [{ sessionId: "$97710", paneId: "%97710", claudeSessionId: CONVERSATION, panePid: 97_710, status: WORKING }],
      requestId: requestId("stagethreequeue"),
    });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("receipt-unavailable");
    expect(w.queue.totalSize()).toBe(0);
    const parent = onlyOp(w.receipts, "broadcast");
    expect(parent.last).toMatchObject({ kind: "outcome", state: "not-sent", reason: "attempt-not-recorded" });
    expect(w.receipts.childrenOf(parent.receiptId)).toEqual([]);
    expect(w.calls).toEqual([]);
  });
});
