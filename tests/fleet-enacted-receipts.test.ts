/**
 * Plan 260910d Stage 3: receipts for enacted plans — `remove-worktree` and
 * `kill-session` on `/api/actions/session`, and the box kills on
 * `/api/actions/box`.
 *
 * **NOTHING HERE RUNS A COMMAND OR SIGNALS A PROCESS.** Every `ActionIo` is a
 * recorder, and every directory is a fixture path that does not exist. A crash
 * is a disk that stops accepting bytes (`FrozenDisk`), never an exception, and
 * a restart is a fresh composition over the same directory: the only thing
 * that crosses the boundary is bytes on disk.
 *
 * The acceptance sentence this file holds the stage to: a confirmed kill or
 * worktree removal whose response was lost cannot be run a second time by
 * re-posting it, before or after a restart.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import type { ProcRecord, Step } from "../tools/fleet/actions.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { openReceiptJournal, summarizeReceipt, type ReceiptJournal, type ReceiptState } from "../tools/fleet/receipt-journal.js";
import { makeActionRoutes, type ActionIo, type ActionRoutes, type StepRun } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { FrozenDisk } from "./helpers/fleet-frozen-disk.js";

const SESSION = "$98711";
const PANE = "%98711";
const PANE_PID = 987_110;
const CONVERSATION = "a553900f-c3ca-42bc-af40-60553103e316";
const NOW = 1_800_200_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const PRIMARY = "/nonexistent/fixture-enacted-checkout";
const WORKTREE = `${PRIMARY}/.claude/worktrees/wf-enacted`;
const BRANCH = "worktree-wf-enacted";
const VITEST_ARGS = `${PRIMARY}/node_modules/.bin/vitest run`;
const OK_STEP: StepRun = { code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null };

function requestId(tag: string): string {
  return `rq-${NOW.toString(36)}-${tag.padEnd(16, "0")}`;
}

function proc(over: Partial<ProcRecord>): ProcRecord {
  return { pid: 6000, ppid: 4000, comm: "node", args: "node index.js", cwd: "/home/greg", rssKiB: 1000, etimeSeconds: 60, ...over };
}
const SUITES = [
  proc({ pid: 6001, comm: "node-MainThread", args: VITEST_ARGS }),
  proc({ pid: 6002, comm: "node-MainThread", args: VITEST_ARGS }),
];

type FakeIo = { io: ActionIo; ran: string[][]; scans: () => number };

/** The box, as a recorder. A dead process (a frozen disk) runs nothing more. */
function fakeIo(opts: {
  disk?: FrozenDisk;
  step?: (step: Step, index: number) => StepRun;
  onRun?: (index: number) => void;
  procs?: readonly ProcRecord[];
} = {}): FakeIo {
  const ran: string[][] = [];
  let scans = 0;
  const io = {
    runStep: (step: Step) => {
      if (opts.disk?.isFrozen() === true) return Promise.resolve(OK_STEP);
      const index = ran.length;
      ran.push([...step.argv]);
      opts.onRun?.(index);
      if (opts.step !== undefined) return Promise.resolve(opts.step(step, index));
      const pass = step.pass;
      return Promise.resolve(pass.kind === "stdout-has-line" ? { ...OK_STEP, stdout: `${pass.line}\n` } : OK_STEP);
    },
    listProcesses: () => {
      scans += 1;
      return Promise.resolve({ ok: true as const, procs: [...(opts.procs ?? [])], unreadable: 0 });
    },
    selfPid: () => 999_999,
    readProcessStart: (pid: number) => ({ read: true as const, ticks: pid * 100 }),
    readBootIdentity: () => ({ read: true as const, id: "fixture-boot" }),
  } as unknown as ActionIo;
  return { io, ran, scans: () => scans };
}

type Boot = { receipts: ReceiptJournal; routes: ActionRoutes; box: FakeIo; logs: string[]; crash(): void };

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-enacted-receipts-"));
  roots.push(dir);
  return dir;
}

function boot(dir: string, runId: string, options: { disk?: FrozenDisk; box?: FakeIo } = {}): Boot {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, "writer.lock");
  const taken = takeLock(lockPath, () => new Date(NOW));
  if (!taken.ok) throw new Error(`could not take the test writer lock: ${JSON.stringify(taken.refusal)}`);
  locks.push({ lock: taken.lock, path: lockPath });
  const disk = options.disk ?? new FrozenDisk();
  const now = (): number => NOW;
  const opened = openReceiptJournal(dir, {
    lock: { held: taken.lock, lockedOutBy: null },
    now,
    serverInstanceId: runId,
    writeLine: disk.writer("receipts"),
  });
  if (opened.kind !== "open") throw new Error(opened.why);
  const book = new QuarantineBook({ now, serverInstanceId: runId });
  const queue = new SteeringQueue({ now, serverInstanceId: runId, quarantine: book, receipts: opened.journal });
  const send = makeSendCoordinator({
    book,
    sendMessage: () => {
      throw new Error("an enacted plan never types into a pane");
    },
    answerQuestion: () => {
      throw new Error("an enacted plan never answers a dialog");
    },
  });
  const box = options.box ?? fakeIo({ disk });
  const logs: string[] = [];
  const routes = makeActionRoutes({
    serverInstanceId: runId,
    queue,
    send,
    io: box.io,
    now,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: (line) => logs.push(line),
    actEnabled: () => true,
    primaryDir: () => PRIMARY,
    yieldToLoop: () => Promise.resolve(),
  });
  let crashed = false;
  return {
    receipts: opened.journal,
    routes,
    box,
    logs,
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

async function post(routes: ActionRoutes, url: string, body?: unknown, method = "POST"): Promise<Res> {
  const stream = new PassThrough();
  if (body !== undefined) stream.write(JSON.stringify(body));
  stream.end();
  const req = Object.assign(stream, {
    url,
    method,
    headers: { host: HOST, origin: ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }) },
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

function removeBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: PANE,
    sessionId: SESSION,
    claudeSessionId: CONVERSATION,
    panePid: PANE_PID,
    status: { kind: "idle" },
    actionId: "remove-worktree",
    mode: "run",
    confirm: true,
    speaker: "greg",
    worktreeDir: WORKTREE,
    branch: BRANCH,
    ...over,
  };
}

function only(journal: ReceiptJournal, op: string): ReceiptState {
  const found = journal.recent(50).filter((state) => state.accepted.op === op);
  expect(found).toHaveLength(1);
  const state = found[0];
  if (state === undefined) throw new Error(`no ${op} receipt`);
  return state;
}

const kinds = (state: ReceiptState | null | undefined): string[] => (state?.records ?? []).map((record) => record.kind);

type Preview = { previewId: string; serverInstanceId: string; actionId: string; material: unknown };

async function killPreview(routes: ActionRoutes): Promise<Preview> {
  const r = await post(routes, "/api/actions/box", { actionId: "kill-test-suites", mode: "dry-run" });
  expect(r.status).toBe(200);
  return r.json.preview as Preview;
}

function killConfirm(preview: Preview, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionId: "kill-test-suites",
    mode: "run",
    confirm: true,
    preview: { previewId: preview.previewId, serverInstanceId: preview.serverInstanceId, actionId: preview.actionId },
    material: preview.material,
    ...over,
  };
}

describe("an enacted session run writes its receipt around the plan", () => {
  it("accepted and attempted land before the first step, one progress per step, then completed", async () => {
    let atFirstStep: string[] = [];
    let journal: ReceiptJournal | null = null;
    const box = fakeIo({
      onRun: (index) => {
        if (index === 0 && journal !== null) atFirstStep = kinds(journal.recent(1)[0]);
      },
    });
    const first = boot(root(), "e1a1e1a1", { box });
    journal = first.receipts;

    const r = await post(first.routes, "/api/actions/session", removeBody({ requestId: requestId("enactedone") }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, op: "ran" });
    expect(typeof r.json.receiptId).toBe("string");
    expect(atFirstStep).toEqual(["accepted", "attempted"]);

    const state = first.receipts.get(String(r.json.receiptId));
    expect(kinds(state)).toEqual(["accepted", "attempted", "progress", "progress", "progress", "outcome"]);
    expect(state?.records.filter((record) => record.kind === "progress")).toMatchObject([
      { step: 0, status: "passed" },
      { step: 1, status: "passed" },
      { step: 2, status: "passed" },
    ]);
    expect(state?.last).toMatchObject({ kind: "outcome", state: "completed", reason: "plan-passed" });
    if (state === null) return;
    expect(summarizeReceipt(state)).toMatchObject({
      op: "enacted-session",
      origin: "enacted",
      state: "completed",
      pending: false,
      stepsCompleted: 3,
      parentReceiptId: null,
      target: { sessionId: SESSION, paneId: PANE, claudeSessionId: CONVERSATION },
    });
    expect(box.ran).toHaveLength(3);
  });

  it("a gate that refuses at step k is plan-stopped, and its code names k", async () => {
    const box = fakeIo({ step: (_step, index) => (index === 1 ? { ...OK_STEP, code: 1, stderr: "unpushed work" } : { ...OK_STEP, stdout: `${BRANCH}\n` }) });
    const first = boot(root(), "e2a2e2a2", { box });
    const r = await post(first.routes, "/api/actions/session", removeBody({ requestId: requestId("enactedstop") }));
    expect(r.json.code).toBe("plan-failed");
    expect(typeof r.json.receiptId).toBe("string");
    const state = first.receipts.get(String(r.json.receiptId));
    expect(kinds(state)).toEqual(["accepted", "attempted", "progress", "progress", "outcome"]);
    expect(state?.last).toMatchObject({ kind: "outcome", state: "plan-stopped", reason: "gate-refused", code: "step-1" });
    expect(box.ran).toHaveLength(2);
  });

  it("a runPlan that throws is outcome-unknown/threw", async () => {
    const box = fakeIo({
      step: (step, index) => {
        if (index === 1) throw new Error("the step runner exploded");
        return step.pass.kind === "stdout-has-line" ? { ...OK_STEP, stdout: `${step.pass.line}\n` } : OK_STEP;
      },
    });
    const first = boot(root(), "e3a3e3a3", { box });
    const r = await post(first.routes, "/api/actions/session", removeBody());
    expect(r.status).toBe(500);
    const state = only(first.receipts, "enacted-session");
    expect(kinds(state)).toEqual(["accepted", "attempted", "progress", "outcome"]);
    expect(state.last).toMatchObject({ kind: "outcome", state: "outcome-unknown", reason: "threw" });
  });

  it("a keyed run is honoured: posting it again is a replay and runs nothing", async () => {
    const first = boot(root(), "e4a4e4a4");
    const body = removeBody({ requestId: requestId("enactedtwice") });
    const once = await post(first.routes, "/api/actions/session", body);
    expect(once.status).toBe(200);
    const again = await post(first.routes, "/api/actions/session", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, op: "receipt", replay: true });
    expect(again.json.receipt).toMatchObject({ receiptId: once.json.receiptId, state: "completed", stepsCompleted: 3 });
    expect(first.box.ran).toHaveLength(3);
  });

  it("a keyed run whose accept cannot land is refused 503 and runs nothing", async () => {
    const disk = new FrozenDisk();
    const first = boot(root(), "e5a5e5a5", { disk });
    disk.arm({ store: "receipts", kind: "accepted", mode: "throw" });
    const r = await post(first.routes, "/api/actions/session", removeBody({ requestId: requestId("enactednoaccept") }));
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("receipt-unavailable");
    expect(first.box.ran).toEqual([]);
    expect(first.receipts.recent(10)).toEqual([]);
  });

  it("a durable run whose attempted cannot land never reaches runPlan", async () => {
    const disk = new FrozenDisk();
    const first = boot(root(), "e6a6e6a6", { disk });
    disk.arm({ store: "receipts", kind: "attempted", mode: "throw" });
    const r = await post(first.routes, "/api/actions/session", removeBody());
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("receipt-unavailable");
    expect(first.box.ran).toEqual([]);
    expect(only(first.receipts, "enacted-session").last).toMatchObject({ kind: "outcome", state: "not-sent", reason: "attempt-not-recorded" });
  });
});

describe("an enacted plan across a frozen-disk restart", () => {
  it("a crash after step 1 of a remove-worktree recovers unknown/interrupted with stepsCompleted 1", async () => {
    const dir = root();
    const disk = new FrozenDisk();
    const box = fakeIo({ disk });
    const first = boot(dir, "f1b1f1b1", { disk, box });
    disk.arm({ store: "receipts", kind: "progress", mode: "after" });
    await post(first.routes, "/api/actions/session", removeBody({ requestId: requestId("enactedcrash") }));
    expect(box.ran).toHaveLength(1);
    first.crash();

    const second = boot(dir, "f2b2f2b2");
    const state = only(second.receipts, "enacted-session");
    expect(state.last).toMatchObject({ kind: "outcome", state: "outcome-unknown", reason: "interrupted" });
    expect(summarizeReceipt(state)).toMatchObject({ state: "outcome-unknown", reason: "interrupted", stepsCompleted: 1 });
    const read = await post(second.routes, "/api/actions/receipts", undefined, "GET");
    expect((read.json.recent as Array<Record<string, unknown>>)[0]).toMatchObject({ receiptId: state.receiptId, stepsCompleted: 1 });
    expect(second.box.ran).toEqual([]);
  });

  it("a duplicate of a completed worktree removal after a restart returns the stored receipt and runs nothing", async () => {
    const dir = root();
    const first = boot(dir, "f3b3f3b3");
    const body = removeBody({ requestId: requestId("enactedrestart") });
    const once = await post(first.routes, "/api/actions/session", body);
    expect(once.status).toBe(200);
    first.crash();

    const second = boot(dir, "f4b4f4b4");
    const again = await post(second.routes, "/api/actions/session", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, op: "receipt", replay: true, receipt: { receiptId: once.json.receiptId, state: "completed" } });
    expect(second.box.ran).toEqual([]);
  });

  it("a duplicate of a confirmed kill after a restart returns the stored receipt and signals nothing, though its preview is gone", async () => {
    const dir = root();
    const first = boot(dir, "f5b5f5b5", { box: fakeIo({ procs: SUITES }) });
    const preview = await killPreview(first.routes);
    const body = killConfirm(preview, { requestId: requestId("killrestart") });
    const once = await post(first.routes, "/api/actions/box", body);
    expect(once.status).toBe(200);
    expect(typeof once.json.receiptId).toBe("string");
    expect(first.box.ran).toEqual([["kill", "-TERM", "6001"], ["kill", "-TERM", "6002"]]);
    const kill = only(first.receipts, "enacted-box");
    expect(kill.accepted.target).toBeNull();
    expect(kill.last).toMatchObject({ kind: "outcome", state: "completed" });
    expect(kill.last.kind === "outcome" ? kill.last.why : "").toContain("signal-accepted 2");
    first.crash();

    const second = boot(dir, "f6b6f6b6", { box: fakeIo({ procs: SUITES }) });
    // The preview it named belonged to the dead run: unkeyed, it is refused.
    const unkeyed = await post(second.routes, "/api/actions/box", killConfirm(preview));
    expect(unkeyed.json.code).toBe("other-instance");
    const again = await post(second.routes, "/api/actions/box", body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, op: "receipt", replay: true, receipt: { receiptId: once.json.receiptId, state: "completed", target: null } });
    expect(second.box.ran).toEqual([]);
  });

  it("a duplicate of a kill interrupted mid-plan returns the unknown receipt after a restart and signals nothing", async () => {
    const dir = root();
    const disk = new FrozenDisk();
    const first = boot(dir, "f7b7f7b7", { disk, box: fakeIo({ disk, procs: SUITES }) });
    const preview = await killPreview(first.routes);
    const body = killConfirm(preview, { requestId: requestId("killcrash") });
    disk.arm({ store: "receipts", kind: "progress", mode: "after" });
    await post(first.routes, "/api/actions/box", body);
    first.crash();

    const second = boot(dir, "f8b8f8b8", { box: fakeIo({ procs: SUITES }) });
    const again = await post(second.routes, "/api/actions/box", body);
    expect(again.json).toMatchObject({ op: "receipt", replay: true, receipt: { state: "outcome-unknown", reason: "interrupted", stepsCompleted: 1 } });
    expect(second.box.ran).toEqual([]);
    expect(second.box.scans()).toBe(0);
  });

  it("a keyed kill whose accept cannot land is refused 503, signals nothing, and leaves the preview usable", async () => {
    const disk = new FrozenDisk();
    const first = boot(root(), "f9b9f9b9", { disk, box: fakeIo({ procs: SUITES }) });
    const preview = await killPreview(first.routes);
    disk.arm({ store: "receipts", kind: "accepted", mode: "throw" });
    const refused = await post(first.routes, "/api/actions/box", killConfirm(preview, { requestId: requestId("killnoaccept") }));
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe("receipt-unavailable");
    expect(first.box.ran).toEqual([]);
    const later = await post(first.routes, "/api/actions/box", killConfirm(preview));
    expect(later.status).toBe(200);
  });
});
